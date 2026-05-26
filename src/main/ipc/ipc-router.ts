/**
 * Centralized IPC handlers. WO-1 owns the hotkey/overlay/window-state/app
 * lifecycle channels here. Other WOs (STT, injection, history, settings,
 * vocab) will register their own routers later.
 */

import { ipcMain, BrowserWindow, app } from 'electron'
import { createLogger } from '@shared/logger'
import { Channels } from '@shared/ipc-types'
import type {
  OverlayStatePayload,
  OverlayPosition,
  WindowInfo,
  HotkeyBindingPayload,
  Wo1Settings
} from '@shared/ipc-types'

import * as settings from '../state/settings-store'
import { getOverlayWindow, repositionOverlay, setOverlayVisible } from '../windows/overlay-window'
import { showMainWindow, hideMainWindow, allowMainClose } from '../windows/main-window'
import { setAutoStart } from '../auto-start'
import { hotkeyManager } from '../hotkey/hotkey-manager'
import { getAllWindowStates, setWindowState } from '../state/window-state'
import type { WindowStateMap, WindowStateRecord } from '@shared/ipc-types'

const log = createLogger('ipc-router')

let overlayStateCache: OverlayStatePayload = { state: 'idle' }

export function getOverlayState(): OverlayStatePayload {
  return overlayStateCache
}

export function broadcastOverlayState(state: OverlayStatePayload): void {
  overlayStateCache = state
  const overlay = getOverlayWindow()
  overlay?.webContents.send(Channels.OverlaySetState, state)
  // Also notify main renderer for waveform/UI sync.
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== overlay) w.webContents.send(Channels.OverlaySetState, state)
  }
}

export function broadcastHotkeyArmed(payload: { hwndSnapshot: WindowInfo | null }): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(Channels.HotkeyArmed, payload)
  }
}

export function broadcastHotkeyReleased(payload: {
  holdDurationMs: number
  hwndSnapshot: WindowInfo | null
}): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(Channels.HotkeyReleased, payload)
  }
}

export function registerIpcHandlers(): void {
  // ── Overlay ────────────────────────────────────────────────────
  ipcMain.handle(Channels.OverlayGetState, () => overlayStateCache)

  ipcMain.handle(Channels.OverlaySetState, (_e, payload: OverlayStatePayload) => {
    broadcastOverlayState(payload)
    return { ok: true }
  })

  ipcMain.handle(Channels.OverlaySetPosition, (_e, position: OverlayPosition) => {
    settings.set('overlay_position', position)
    repositionOverlay()
    return { ok: true }
  })

  ipcMain.handle(Channels.OverlaySetVisible, (_e, visible: boolean) => {
    setOverlayVisible(visible)
    return { ok: true }
  })

  // ── Hotkey ─────────────────────────────────────────────────────
  ipcMain.handle(Channels.HotkeySetBinding, (_e, payload: HotkeyBindingPayload) => {
    settings.set('hotkey', payload.accelerator)
    hotkeyManager.rebind(payload.accelerator)
    return { ok: true, mode: hotkeyManager.getMode() }
  })

  ipcMain.handle(Channels.HotkeyTestCombo, () => {
    return { mode: hotkeyManager.getMode(), binding: settings.get('hotkey') }
  })

  // ── App lifecycle ──────────────────────────────────────────────
  ipcMain.handle(Channels.AppShowMain, () => {
    showMainWindow()
    return { ok: true }
  })

  ipcMain.handle(Channels.AppMinimizeToTray, () => {
    hideMainWindow()
    return { ok: true }
  })

  ipcMain.handle(Channels.AppQuit, () => {
    log.info('app:quit invoked via IPC')
    allowMainClose()
    app.quit()
    return { ok: true }
  })

  ipcMain.handle(Channels.AppOpenSettings, () => {
    // Placeholder for WO-4 — for now, surface the main window.
    showMainWindow()
    return { ok: true }
  })

  ipcMain.handle(Channels.AppOpenHistory, () => {
    showMainWindow()
    return { ok: true }
  })

  ipcMain.handle(Channels.AppToggleMute, () => {
    const next = !settings.get('muted')
    settings.set('muted', next)
    return { muted: next }
  })

  ipcMain.handle(Channels.AppAutoStartSet, (_e, payload: { enabled: boolean }) => {
    const live = setAutoStart(payload.enabled)
    settings.set('auto_start', live.openAtLogin)
    return { openAtLogin: live.openAtLogin }
  })

  ipcMain.handle(Channels.AppOnboardingStatus, () => ({
    needsOnboarding: !settings.get('first_run_completed')
  }))

  // Stub: real implementation belongs to WO-3 (PowerShell GetForegroundWindow).
  ipcMain.handle(Channels.AppActiveWindow, () => {
    // TODO(WO-3): implement PowerShell GetForegroundWindow integration.
    return null
  })

  // ── Window state ───────────────────────────────────────────────
  ipcMain.handle(Channels.WindowStateGet, (_e, key?: keyof WindowStateMap) => {
    const all = getAllWindowStates()
    return key ? all[key] : all
  })

  ipcMain.handle(
    Channels.WindowStateSet,
    (_e, payload: { key: keyof WindowStateMap; record: WindowStateRecord }) => {
      setWindowState(payload.key, payload.record)
      return { ok: true }
    }
  )

  // ── Settings (minimal subset; WO-4 expands) ────────────────────
  ipcMain.handle(Channels.SettingsGet, (_e, key?: keyof Wo1Settings) => {
    return key ? settings.get(key) : settings.getAll()
  })

  ipcMain.handle(
    Channels.SettingsSet,
    (_e, payload: { key: keyof Wo1Settings; value: Wo1Settings[keyof Wo1Settings] }) => {
      settings.set(payload.key, payload.value)
      return { ok: true }
    }
  )

  // Bridge settings changes back to all renderers.
  settings.onChange((key, value) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(Channels.SettingsChanged, { key, value })
    }
  })

  log.info('IPC handlers registered (WO-1 surface)')
}
