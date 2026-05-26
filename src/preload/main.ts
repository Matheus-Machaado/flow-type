/**
 * Preload for the main window. Exposes `window.flowtype.*` typed API to
 * the renderer via contextBridge. WO-1 + WO-2 + WO-4 surfaces.
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  Channels,
  type OverlayStatePayload,
  type OverlayPosition,
  type WindowInfo,
  type Wo1Settings,
  type WindowStateMap,
  type WindowStateRecord,
  type HistoryListRequest,
  type HistorySearchRequest,
  type HistoryExportRequest,
  type VocabAddRequest,
  type VocabUpdateRequest
} from '@shared/ipc-types'

type Unsubscribe = () => void

const SttChannels = {
  GetProviderSettings: 'stt:get-provider-settings',
  SetForceLocal: 'stt:set-force-local',
  SetLanguage: 'stt:set-language',
  TestTranscribe: 'stt:test-transcribe',
  AddSlot: 'stt:add-slot',
  UpdateSlot: 'stt:update-slot',
  RemoveSlot: 'stt:remove-slot',
  TestSlot: 'stt:test-slot',
  PoolSnapshot: 'stt:pool-snapshot'
} as const

const api = {
  overlay: {
    getState: (): Promise<OverlayStatePayload> => ipcRenderer.invoke(Channels.OverlayGetState),
    setState: (s: OverlayStatePayload) => ipcRenderer.invoke(Channels.OverlaySetState, s),
    setPosition: (p: OverlayPosition) => ipcRenderer.invoke(Channels.OverlaySetPosition, p),
    setVisible: (v: boolean) => ipcRenderer.invoke(Channels.OverlaySetVisible, v),
    onSetState: (handler: (s: OverlayStatePayload) => void): Unsubscribe => {
      const wrap = (_: unknown, s: OverlayStatePayload): void => handler(s)
      ipcRenderer.on(Channels.OverlaySetState, wrap)
      return () => ipcRenderer.removeListener(Channels.OverlaySetState, wrap)
    }
  },
  hotkey: {
    setBinding: (accelerator: string) =>
      ipcRenderer.invoke(Channels.HotkeySetBinding, { accelerator }),
    testCombo: () => ipcRenderer.invoke(Channels.HotkeyTestCombo),
    onArmed: (handler: (p: { hwndSnapshot: WindowInfo | null }) => void): Unsubscribe => {
      const wrap = (_: unknown, p: { hwndSnapshot: WindowInfo | null }): void => handler(p)
      ipcRenderer.on(Channels.HotkeyArmed, wrap)
      return () => ipcRenderer.removeListener(Channels.HotkeyArmed, wrap)
    },
    onReleased: (
      handler: (p: { holdDurationMs: number; hwndSnapshot: WindowInfo | null }) => void
    ): Unsubscribe => {
      const wrap = (
        _: unknown,
        p: { holdDurationMs: number; hwndSnapshot: WindowInfo | null }
      ): void => handler(p)
      ipcRenderer.on(Channels.HotkeyReleased, wrap)
      return () => ipcRenderer.removeListener(Channels.HotkeyReleased, wrap)
    }
  },
  app: {
    quit: () => ipcRenderer.invoke(Channels.AppQuit),
    showMain: () => ipcRenderer.invoke(Channels.AppShowMain),
    minimizeToTray: () => ipcRenderer.invoke(Channels.AppMinimizeToTray),
    openSettings: () => ipcRenderer.invoke(Channels.AppOpenSettings),
    openHistory: () => ipcRenderer.invoke(Channels.AppOpenHistory),
    toggleMute: () => ipcRenderer.invoke(Channels.AppToggleMute),
    autoStartSet: (enabled: boolean) =>
      ipcRenderer.invoke(Channels.AppAutoStartSet, { enabled }),
    onboardingStatus: () => ipcRenderer.invoke(Channels.AppOnboardingStatus),
    activeWindow: () => ipcRenderer.invoke(Channels.AppActiveWindow)
  },
  windowState: {
    get: (key?: keyof WindowStateMap) => ipcRenderer.invoke(Channels.WindowStateGet, key),
    set: (key: keyof WindowStateMap, record: WindowStateRecord) =>
      ipcRenderer.invoke(Channels.WindowStateSet, { key, record })
  },
  settings: {
    get: (key?: keyof Wo1Settings) => ipcRenderer.invoke(Channels.SettingsGet, key),
    getAll: () => ipcRenderer.invoke(Channels.SettingsGet),
    set: <K extends keyof Wo1Settings>(key: K, value: Wo1Settings[K]) =>
      ipcRenderer.invoke(Channels.SettingsSet, { key, value }),
    onChange: (handler: (key: string, value: unknown) => void): Unsubscribe => {
      const wrap = (_: unknown, payload: { key: string; value: unknown }): void =>
        handler(payload.key, payload.value)
      ipcRenderer.on(Channels.SettingsChanged, wrap)
      return () => ipcRenderer.removeListener(Channels.SettingsChanged, wrap)
    }
  },
  stt: {
    getProviderSettings: () => ipcRenderer.invoke(SttChannels.GetProviderSettings),
    setForceLocal: (enabled: boolean) => ipcRenderer.invoke(SttChannels.SetForceLocal, enabled),
    setLanguage: (language: string | null) =>
      ipcRenderer.invoke(SttChannels.SetLanguage, language),
    testTranscribe: (audio: ArrayBuffer, language?: string) =>
      ipcRenderer.invoke(SttChannels.TestTranscribe, { audio, language }),
    poolSnapshot: () => ipcRenderer.invoke(SttChannels.PoolSnapshot),
    addSlot: (payload: { slotIndex: 0 | 1 | 2; apiKey: string; label?: string; dailyCap?: number }) =>
      ipcRenderer.invoke(SttChannels.AddSlot, payload),
    updateSlot: (payload: { slotIndex: 0 | 1 | 2; apiKey: string; label?: string; dailyCap?: number }) =>
      ipcRenderer.invoke(SttChannels.UpdateSlot, payload),
    removeSlot: (slotIndex: 0 | 1 | 2) =>
      ipcRenderer.invoke(SttChannels.RemoveSlot, { slotIndex }),
    testSlot: (slotIndex: 0 | 1 | 2) => ipcRenderer.invoke(SttChannels.TestSlot, { slotIndex })
  },
  history: {
    list: (req?: HistoryListRequest) => ipcRenderer.invoke(Channels.HistoryList, req ?? {}),
    search: (req: HistorySearchRequest) => ipcRenderer.invoke(Channels.HistorySearch, req),
    getById: (id: string) => ipcRenderer.invoke(Channels.HistoryGetById, id),
    updateText: (id: string, text: string) =>
      ipcRenderer.invoke(Channels.HistoryUpdateText, { id, text }),
    delete: (id: string) => ipcRenderer.invoke(Channels.HistoryDelete, id),
    export: (req: HistoryExportRequest) => ipcRenderer.invoke(Channels.HistoryExport, req)
  },
  vocab: {
    list: () => ipcRenderer.invoke(Channels.VocabList),
    add: (entry: VocabAddRequest) => ipcRenderer.invoke(Channels.VocabAdd, entry),
    update: (patch: VocabUpdateRequest) => ipcRenderer.invoke(Channels.VocabUpdate, patch),
    remove: (id: string) => ipcRenderer.invoke(Channels.VocabRemove, id)
  }
}

contextBridge.exposeInMainWorld('flowtype', api)

export type FlowtypeAPI = typeof api
