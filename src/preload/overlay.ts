/**
 * Preload for the overlay window. Exposes a smaller, events-only surface
 * so the overlay renderer can subscribe to state transitions and badges
 * without being able to mutate global state.
 *
 * v0.1.1: extended to receive hotkey events (armed/released) so the overlay
 * renderer can drive MediaRecorder and send audio buffers back to main for
 * the full STT → vocab → inject → history pipeline.
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  Channels,
  type OverlayStatePayload,
  type OverlayBadgePayload,
  type HotkeyArmedPayload,
  type HotkeyReleasedPayload,
  type HotkeyLockChangedPayload,
  type HotkeyForceUnlockPayload
} from '@shared/ipc-types'

type Unsubscribe = () => void

export interface TranscribeAndInjectResult {
  ok: boolean
  error?: string
  text?: string
  provider?: 'groq' | 'local'
  latencyMs?: number
}

const api = {
  getState: (): Promise<OverlayStatePayload> => ipcRenderer.invoke(Channels.OverlayGetState),
  onSetState: (handler: (s: OverlayStatePayload) => void): Unsubscribe => {
    const wrap = (_: unknown, s: OverlayStatePayload): void => handler(s)
    ipcRenderer.on(Channels.OverlaySetState, wrap)
    return () => ipcRenderer.removeListener(Channels.OverlaySetState, wrap)
  },
  onBadge: (handler: (b: OverlayBadgePayload) => void): Unsubscribe => {
    const wrap = (_: unknown, b: OverlayBadgePayload): void => handler(b)
    ipcRenderer.on(Channels.OverlayShowBadge, wrap)
    return () => ipcRenderer.removeListener(Channels.OverlayShowBadge, wrap)
  },
  onHotCornerEnter: (handler: () => void): Unsubscribe => {
    const wrap = (): void => handler()
    ipcRenderer.on(Channels.OverlayHotCornerEnter, wrap)
    return () => ipcRenderer.removeListener(Channels.OverlayHotCornerEnter, wrap)
  },
  onHotCornerLeave: (handler: () => void): Unsubscribe => {
    const wrap = (): void => handler()
    ipcRenderer.on(Channels.OverlayHotCornerLeave, wrap)
    return () => ipcRenderer.removeListener(Channels.OverlayHotCornerLeave, wrap)
  },
  // Hotkey events forwarded from main so overlay can start/stop MediaRecorder.
  onHotkeyArmed: (handler: (p: HotkeyArmedPayload) => void): Unsubscribe => {
    const wrap = (_: unknown, p: HotkeyArmedPayload): void => handler(p)
    ipcRenderer.on(Channels.HotkeyArmed, wrap)
    return () => ipcRenderer.removeListener(Channels.HotkeyArmed, wrap)
  },
  onHotkeyReleased: (handler: (p: HotkeyReleasedPayload) => void): Unsubscribe => {
    const wrap = (_: unknown, p: HotkeyReleasedPayload): void => handler(p)
    ipcRenderer.on(Channels.HotkeyReleased, wrap)
    return () => ipcRenderer.removeListener(Channels.HotkeyReleased, wrap)
  },
  onHotkeyLockChanged: (handler: (p: HotkeyLockChangedPayload) => void): Unsubscribe => {
    const wrap = (_: unknown, p: HotkeyLockChangedPayload): void => handler(p)
    ipcRenderer.on(Channels.HotkeyLockChanged, wrap)
    return () => ipcRenderer.removeListener(Channels.HotkeyLockChanged, wrap)
  },
  /**
   * Overlay → main: ask main to force-exit LOCK (e.g. recording cap reached).
   * Main will run forceUnlock(), which emits the standard released event so
   * the rest of the pipeline (STT → inject → history) runs untouched.
   */
  requestForceUnlock: (payload: HotkeyForceUnlockPayload): void => {
    ipcRenderer.send(Channels.HotkeyForceUnlock, payload)
  },
  /**
   * Send captured audio (webm/opus) to main for the full pipeline:
   * STT cascade → vocab corrections → text injection → history persistence.
   * Returns when injection finishes (or fails). Main broadcasts overlay
   * state transitions throughout (capturing → processing → idle).
   */
  transcribeAndInject: (
    audioBuffer: ArrayBuffer,
    durationMs: number
  ): Promise<TranscribeAndInjectResult> =>
    ipcRenderer.invoke(Channels.SttTranscribeAndInject, { audioBuffer, durationMs })
}

contextBridge.exposeInMainWorld('flowtypeOverlay', api)

export type FlowtypeOverlayAPI = typeof api
