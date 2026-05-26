/**
 * Shared IPC channel types — consumed by main, preload, renderers.
 * Source of truth: projects/flowtype/architecture/internal-contracts.md §1.
 *
 * Only channels for WO-1 are fully implemented here. Other groups are declared
 * as stubs so the API surface compiles; later WOs flesh them out.
 */

// ─── Common types ───────────────────────────────────────────────────────────

export interface WindowInfo {
  hwnd: number
  exeName: string
  windowTitle: string
  processId: number
}

export type OverlayState = 'idle' | 'armed' | 'capturing' | 'processing'

export interface OverlayStatePayload {
  state: OverlayState
  meta?: {
    volumeRms?: number
    label?: string
  }
}

export type OverlayPosition = 'br' | 'bl' | 'tr' | 'tl' | 'custom'

export interface OverlayBadgePayload {
  kind: 'groq' | 'local'
  slotIndex?: number
  slotLabel?: string
  latencyMs: number
  ttlMs: number
}

// ─── Window state persistence ───────────────────────────────────────────────

export interface WindowStateRecord {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

export interface WindowStateMap {
  main?: WindowStateRecord
  settings?: WindowStateRecord
  history?: WindowStateRecord
  onboarding?: WindowStateRecord
}

// ─── Hotkey ──────────────────────────────────────────────────────────────────

export interface HotkeyArmedPayload {
  hwndSnapshot: WindowInfo | null
}

export interface HotkeyReleasedPayload {
  holdDurationMs: number
  hwndSnapshot: WindowInfo | null
}

export interface HotkeyTestComboPayload {
  combo: string
  ok: boolean
}

export interface HotkeyBindingPayload {
  accelerator: string
}

// ─── App lifecycle ──────────────────────────────────────────────────────────

export interface AppQuitOptions {
  reason?: string
}

export interface OnboardingStatus {
  needsOnboarding: boolean
}

// ─── Settings (subset relevant to WO-1) ─────────────────────────────────────

export interface Wo1Settings {
  hotkey: string                       // e.g. 'Right Ctrl' | 'F12'
  hotkey_hold_min_ms: number           // default 150 per WO-1 brief
  overlay_position: OverlayPosition
  overlay_custom_xy?: [number, number]
  overlay_idle_opacity: number         // 0..1
  auto_start: boolean
  muted: boolean
  first_run_completed: boolean
}

// ─── History (WO-4) ─────────────────────────────────────────────────────────

export interface HistoryFilters {
  dateFrom?: string
  dateTo?: string
  appExe?: string[]
  provider?: 'groq' | 'local'
}

export interface HistoryListRequest {
  filters?: HistoryFilters
  offset?: number
  limit?: number
}

export interface HistorySearchRequest extends HistoryListRequest {
  query: string
}

export interface HistoryExportRequest {
  format: 'md' | 'json'
  filters?: HistoryFilters
}

// ─── Vocab (WO-4) ───────────────────────────────────────────────────────────

export interface VocabAddRequest {
  term_wrong: string
  term_correct: string
  case_sensitive?: boolean
  scope?: string
}

export interface VocabUpdateRequest {
  id: string
  term_wrong?: string
  term_correct?: string
  case_sensitive?: boolean
  scope?: string
}

// ─── Channel names (typed) ──────────────────────────────────────────────────

export const Channels = {
  // Hotkey
  HotkeyArmed: 'hotkey:armed',
  HotkeyReleased: 'hotkey:released',
  HotkeyTestCombo: 'hotkey:test-combo',
  HotkeyRebind: 'hotkey:rebind',
  HotkeySetBinding: 'hotkey:set-binding',

  // Overlay
  OverlaySetState: 'overlay:set-state',
  OverlayGetState: 'overlay:get-state',
  OverlaySetPosition: 'overlay:set-position',
  OverlaySetVisible: 'overlay:set-visible',
  OverlayShowBadge: 'overlay:show-badge',
  OverlayHotCornerEnter: 'overlay:hot-corner-enter',
  OverlayHotCornerLeave: 'overlay:hot-corner-leave',

  // App lifecycle
  AppQuit: 'app:quit',
  AppMinimizeToTray: 'app:minimize-to-tray',
  AppShowMain: 'app:show-main',
  AppOpenSettings: 'app:open-settings',
  AppOpenHistory: 'app:open-history',
  AppToggleMute: 'app:toggle-mute',
  AppAutoStartSet: 'app:auto-start-set',
  AppActiveWindow: 'app:active-window',
  AppActiveWindowDetectOnce: 'app:active-window-detect-once',
  AppOnboardingStatus: 'app:onboarding-status',

  // STT — orchestrated full pipeline (hotkey → record → transcribe → vocab → inject → history)
  // Sent from overlay renderer to main with audio buffer; main returns when injection finishes.
  SttTranscribeAndInject: 'stt:transcribe-and-inject',

  // Text injection (WO-3)
  TextInjectionPaste: 'text-injection:paste',
  TextInjectionResult: 'text-injection:result',

  // Window state
  WindowStateGet: 'window-state:get',
  WindowStateSet: 'window-state:set',

  // Settings
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  SettingsChanged: 'settings:changed',

  // History (WO-4)
  HistoryList: 'history:list',
  HistorySearch: 'history:search',
  HistoryGetById: 'history:get-by-id',
  HistoryUpdateText: 'history:update',
  HistoryDelete: 'history:delete',
  HistoryExport: 'history:export',

  // Vocab (WO-4)
  VocabList: 'vocab:list',
  VocabAdd: 'vocab:add',
  VocabUpdate: 'vocab:update',
  VocabRemove: 'vocab:remove'
} as const

export type ChannelName = (typeof Channels)[keyof typeof Channels]
