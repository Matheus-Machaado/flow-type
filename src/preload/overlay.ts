/**
 * Preload for the overlay window. Exposes a smaller, events-only surface
 * so the overlay renderer can subscribe to state transitions and badges
 * without being able to mutate global state.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { Channels, type OverlayStatePayload, type OverlayBadgePayload } from '@shared/ipc-types'

type Unsubscribe = () => void

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
  }
}

contextBridge.exposeInMainWorld('flowtypeOverlay', api)

export type FlowtypeOverlayAPI = typeof api
