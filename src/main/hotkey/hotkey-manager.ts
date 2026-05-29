/**
 * Global hotkey hold/release detection.
 *
 * uIOhook is the primary path (Electron's globalShortcut doesn't fire on
 * release). We listen to keydown/keyup, identify "Right Ctrl" (or any
 * remapped binding), enforce a configurable hold threshold, then emit:
 *
 *   - `hotkey:armed`         once hold > hotkey_hold_min_ms (push-to-talk)
 *   - `hotkey:released`      on keyup (if armed)
 *   - `hotkey:lock-changed`  when double-tap toggles lock on/off
 *
 * Lock mode (CR F-002): two quick taps of the same key within
 * DOUBLE_TAP_GAP_MAX_MS enter LOCK. While locked, the overlay stays in
 * "capturing" without anyone holding the key. Any subsequent single tap
 * (or the recording cap timeout fired by the overlay) exits LOCK,
 * emitting a regular `hotkey:released`.
 *
 * If uIOhook fails to load (missing native binary), we degrade gracefully
 * to Electron `globalShortcut` (press-only) so the rest of the app still
 * boots; a warning is logged and the badge in the overlay reflects this
 * via the `mode` flag. Lock mode is uIOhook-only.
 */

import { app, globalShortcut } from 'electron'
import { createLogger } from '@shared/logger'
import * as settings from '../state/settings-store'

const log = createLogger('hotkey-manager')

export type HotkeyMode = 'uiohook' | 'electron-fallback' | 'disabled'

export interface HotkeyEvents {
  onArmed: (info: { startedAt: number; locked?: boolean }) => void
  onReleased: (info: { holdDurationMs: number; cancelled: boolean; fromLock?: boolean }) => void
  onLockChanged?: (info: { locked: boolean; since?: number }) => void
}

// Tap = keydown→keyup within this window (anything longer is a hold candidate).
const TAP_MAX_MS = 200
// Two taps must be at most this far apart (1st keyup → 2nd keydown) to lock.
const DOUBLE_TAP_GAP_MAX_MS = 350

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

  // Lock state (CR F-002 double-tap toggle).
  private isLocked = false
  private lockedSince: number | null = null
  private lastTapKeyupAt: number | null = null
  private tapExpireTimer: NodeJS.Timeout | null = null
  // Skip exactly one keyup (set when we synthetically consume a press,
  // e.g. the 2nd keydown that entered LOCK, or the keydown that left LOCK).
  private ignoreNextKeyup = false

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

    const now = Date.now()

    // If locked, any keydown of the bound key exits LOCK as a normal release.
    if (this.isLocked) {
      const heldFor = now - (this.lockedSince ?? now)
      this.isLocked = false
      this.lockedSince = null
      this.lastTapKeyupAt = null
      this.armedAt = null
      this.armedFired = false
      this.heldKeycode = null
      // The keyup paired with this keydown will arrive shortly; swallow it.
      this.ignoreNextKeyup = true
      this.events?.onLockChanged?.({ locked: false })
      this.events?.onReleased({ holdDurationMs: heldFor, cancelled: false, fromLock: true })
      log.debug('hotkey lock OFF (keypress while locked)', { heldFor })
      return
    }

    // Already holding — ignore auto-repeat events.
    if (this.heldKeycode !== null) return

    this.heldKeycode = e.keycode
    this.armedAt = now
    this.armedFired = false

    // Double-tap detection: is there a recent short tap within the gap window?
    if (
      this.lastTapKeyupAt !== null &&
      now - this.lastTapKeyupAt <= DOUBLE_TAP_GAP_MAX_MS
    ) {
      this.isLocked = true
      this.lockedSince = now
      this.armedFired = true
      this.ignoreNextKeyup = true
      this.lastTapKeyupAt = null
      if (this.tapExpireTimer) {
        clearTimeout(this.tapExpireTimer)
        this.tapExpireTimer = null
      }
      this.events?.onLockChanged?.({ locked: true, since: now })
      this.events?.onArmed({ startedAt: now, locked: true })
      log.debug('hotkey lock ON (double-tap)', { since: now })
      return
    }

    // Normal flow: schedule "armed" after the hold threshold.
    this.armTimer = setTimeout(() => {
      if (this.heldKeycode === null) return
      this.armedFired = true
      this.events?.onArmed({ startedAt: this.armedAt ?? Date.now() })
    }, this.holdMinMs)
  }

  private handleUp(e: UiohookKeyEvent): void {
    if (this.mode !== 'uiohook') return
    if (e.keycode !== this.heldKeycode && !this.ignoreNextKeyup) return

    // Swallow exactly one keyup after a synthetic press consumption
    // (the 2nd keydown that entered LOCK, or the tap that exited LOCK).
    if (this.ignoreNextKeyup) {
      this.ignoreNextKeyup = false
      if (this.armTimer) {
        clearTimeout(this.armTimer)
        this.armTimer = null
      }
      this.heldKeycode = null
      this.armedAt = null
      this.armedFired = false
      return
    }

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
      // Short release: candidate for double-tap if duration ≤ TAP_MAX_MS.
      if (heldFor <= TAP_MAX_MS) {
        this.lastTapKeyupAt = Date.now()
        if (this.tapExpireTimer) clearTimeout(this.tapExpireTimer)
        this.tapExpireTimer = setTimeout(() => {
          this.lastTapKeyupAt = null
          this.tapExpireTimer = null
        }, DOUBLE_TAP_GAP_MAX_MS + 50)
      }
      log.debug('hotkey cancelled (released before threshold)', {
        heldFor,
        threshold: this.holdMinMs
      })
      return
    }
    this.events?.onReleased({ holdDurationMs: heldFor, cancelled: false })
  }

  /**
   * External trigger to leave LOCK programmatically (e.g. overlay timer
   * hit the 60s cap and forced a stop, or a future Settings 'Cancel'
   * button). No-op when not locked.
   */
  forceUnlock(reason: string): void {
    if (!this.isLocked) return
    const now = Date.now()
    const heldFor = now - (this.lockedSince ?? now)
    this.isLocked = false
    this.lockedSince = null
    this.armedFired = false
    this.armedAt = null
    this.heldKeycode = null
    this.lastTapKeyupAt = null
    log.debug('hotkey lock OFF (forced)', { reason, heldFor })
    this.events?.onLockChanged?.({ locked: false })
    this.events?.onReleased({ holdDurationMs: heldFor, cancelled: false, fromLock: true })
  }

  isLockActive(): boolean {
    return this.isLocked
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
    if (this.tapExpireTimer) clearTimeout(this.tapExpireTimer)
  }
}

export const hotkeyManager = new HotkeyManager()

app.on('will-quit', () => hotkeyManager.shutdown())
