/**
 * Global hotkey hold/release detection.
 *
 * uIOhook is the primary path (Electron's globalShortcut doesn't fire on
 * release). We listen to keydown/keyup, identify "Right Ctrl" (or any
 * remapped binding), enforce a configurable hold threshold, then emit:
 *
 *   - `hotkey:armed`    once hold > hotkey_hold_min_ms
 *   - `hotkey:released` on keyup (if armed)
 *
 * If uIOhook fails to load (missing native binary), we degrade gracefully
 * to Electron `globalShortcut` (press-only) so the rest of the app still
 * boots — a warning is logged and the badge in the overlay reflects this
 * via the `mode` flag.
 */

import { app, globalShortcut } from 'electron'
import { createLogger } from '@shared/logger'
import * as settings from '../state/settings-store'

const log = createLogger('hotkey-manager')

export type HotkeyMode = 'uiohook' | 'electron-fallback' | 'disabled'

export interface HotkeyEvents {
  onArmed: (info: { startedAt: number }) => void
  onReleased: (info: { holdDurationMs: number; cancelled: boolean }) => void
}

interface UiohookKeyEvent {
  keycode: number
}

type UiohookModule = {
  uIOhook: {
    on: (event: string, fn: (e: UiohookKeyEvent) => void) => void
    off?: (event: string, fn: (e: UiohookKeyEvent) => void) => void
    removeAllListeners?: (event?: string) => void
    start: () => void
    stop: () => void
  }
  UiohookKey: Record<string, number>
}

// uIOhook keycode names we accept. Matches uiohook-napi `UiohookKey` enum.
const KEYCODE_MAP_NAMES: Record<string, string[]> = {
  'Right Ctrl': ['RightControl', 'CtrlRight'],
  'Left Ctrl': ['Ctrl', 'CtrlLeft', 'LeftControl'],
  F12: ['F12'],
  F8: ['F8'],
  F9: ['F9']
}

class HotkeyManager {
  private mode: HotkeyMode = 'disabled'
  private uio: UiohookModule | null = null
  private armedAt: number | null = null
  private armedFired = false
  private heldKeycode: number | null = null
  private armTimer: NodeJS.Timeout | null = null
  private muted = false
  private currentBinding: string = 'Right Ctrl'
  private holdMinMs = 150
  private events: HotkeyEvents | null = null

  init(events: HotkeyEvents): void {
    this.events = events
    this.currentBinding = settings.get('hotkey')
    this.holdMinMs = settings.get('hotkey_hold_min_ms')
    this.muted = settings.get('muted')

    settings.onChange((key, value) => {
      if (key === 'muted') this.muted = Boolean(value)
      if (key === 'hotkey_hold_min_ms') this.holdMinMs = Number(value) || 150
      if (key === 'hotkey') {
        this.currentBinding = String(value)
        this.rebind(this.currentBinding)
      }
    })

    this.tryUiohook() || this.startElectronFallback()
  }

  getMode(): HotkeyMode {
    return this.mode
  }

  private resolveKeycode(binding: string): number | null {
    if (!this.uio) return null
    const names = KEYCODE_MAP_NAMES[binding] ?? []
    for (const n of names) {
      const k = this.uio.UiohookKey[n]
      if (typeof k === 'number') return k
    }
    log.warn('no uIOhook keycode for binding', { binding, tried: names })
    return null
  }

  private tryUiohook(): boolean {
    try {
      // Dynamic require to keep failure non-fatal.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('uiohook-napi') as UiohookModule
      this.uio = mod
      const keycode = this.resolveKeycode(this.currentBinding)
      if (keycode === null) {
        log.warn('uIOhook loaded but binding unresolved — falling back')
        return false
      }

      mod.uIOhook.on('keydown', (e) => this.handleDown(e))
      mod.uIOhook.on('keyup', (e) => this.handleUp(e))
      mod.uIOhook.start()
      this.mode = 'uiohook'
      log.info('hotkey-manager started in uiohook mode', { binding: this.currentBinding, keycode })
      return true
    } catch (e) {
      log.warn('uIOhook failed to load — using Electron globalShortcut fallback', {
        error: String(e)
      })
      this.uio = null
      return false
    }
  }

  private startElectronFallback(): void {
    const accelerator = this.toElectronAccelerator(this.currentBinding)
    try {
      const ok = globalShortcut.register(accelerator, () => {
        // Press-only fallback: simulate a 250ms hold synthesized window.
        if (this.muted) return
        const now = Date.now()
        this.armedAt = now
        this.armedFired = true
        this.events?.onArmed({ startedAt: now })
        setTimeout(() => {
          if (this.armedAt !== now) return
          this.events?.onReleased({
            holdDurationMs: 250,
            cancelled: false
          })
          this.armedAt = null
          this.armedFired = false
        }, 250)
      })
      if (ok) {
        this.mode = 'electron-fallback'
        log.info('hotkey-manager started in electron-fallback mode', { accelerator })
      } else {
        log.error('Electron globalShortcut.register failed', { accelerator })
        this.mode = 'disabled'
      }
    } catch (e) {
      log.error('Electron globalShortcut crashed', { error: String(e) })
      this.mode = 'disabled'
    }
  }

  private toElectronAccelerator(binding: string): string {
    // Electron's globalShortcut doesn't distinguish Right/Left Ctrl; we just
    // register Ctrl as a synthetic fallback so the app remains functional.
    if (binding === 'Right Ctrl' || binding === 'Left Ctrl') return 'CommandOrControl+Alt+Space'
    if (binding === 'F12') return 'F12'
    if (binding === 'F8') return 'F8'
    if (binding === 'F9') return 'F9'
    return binding
  }

  private handleDown(e: UiohookKeyEvent): void {
    if (this.mode !== 'uiohook' || this.muted) return
    const keycode = this.resolveKeycode(this.currentBinding)
    if (keycode === null || e.keycode !== keycode) return

    // Already holding — ignore auto-repeat events.
    if (this.heldKeycode !== null) return

    this.heldKeycode = e.keycode
    this.armedAt = Date.now()
    this.armedFired = false

    // Defer "armed" signal until hold threshold passed.
    this.armTimer = setTimeout(() => {
      if (this.heldKeycode === null) return
      this.armedFired = true
      this.events?.onArmed({ startedAt: this.armedAt ?? Date.now() })
    }, this.holdMinMs)
  }

  private handleUp(e: UiohookKeyEvent): void {
    if (this.mode !== 'uiohook') return
    if (e.keycode !== this.heldKeycode) return

    const heldFor = Date.now() - (this.armedAt ?? Date.now())
    const wasArmed = this.armedFired
    const cancelled = !wasArmed

    if (this.armTimer) {
      clearTimeout(this.armTimer)
      this.armTimer = null
    }
    this.heldKeycode = null
    this.armedAt = null
    this.armedFired = false

    if (cancelled) {
      // released before hold threshold — silently drop, no event emitted
      log.debug('hotkey cancelled (released before threshold)', {
        heldFor,
        threshold: this.holdMinMs
      })
      return
    }
    this.events?.onReleased({ holdDurationMs: heldFor, cancelled: false })
  }

  rebind(newBinding: string): void {
    this.currentBinding = newBinding
    if (this.mode === 'electron-fallback') {
      globalShortcut.unregisterAll()
      this.startElectronFallback()
    }
    // uiohook is keycode-resolved at runtime — nothing to reconfigure.
  }

  shutdown(): void {
    try {
      this.uio?.uIOhook?.stop()
    } catch {
      /* ignore */
    }
    try {
      globalShortcut.unregisterAll()
    } catch {
      /* ignore */
    }
    if (this.armTimer) clearTimeout(this.armTimer)
  }
}

export const hotkeyManager = new HotkeyManager()

app.on('will-quit', () => hotkeyManager.shutdown())
