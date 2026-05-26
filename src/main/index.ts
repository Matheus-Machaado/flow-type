/**
 * flowtype main process entry. Wires the modules: window-state, settings,
 * overlay, main window, tray, hotkey, IPC handlers, auto-start. Boots either
 * in autostart-hidden mode (--autostart flag) or normal mode.
 */

import { app, BrowserWindow, session } from 'electron'
import { createLogger, getLogFilePath } from '@shared/logger'

import * as settings from './state/settings-store'
import { createMainWindow } from './windows/main-window'
import { createOverlayWindow } from './windows/overlay-window'
import { createTray, destroyTray, isPaused } from './tray/tray-manager'
import { hotkeyManager } from './hotkey/hotkey-manager'
import {
  registerIpcHandlers,
  broadcastOverlayState,
  broadcastHotkeyArmed,
  broadcastHotkeyReleased
} from './ipc/ipc-router'
import { setAutoStart, isAutoStartEnabled, startedFromLogin } from './auto-start'

// WO-2/3/4/6 integration: lazily wired in `wireBackend()` below so a native
// module failure (better-sqlite3 / uIOhook / nut-js) cannot prevent the
// renderer from coming up. Each subsystem is best-effort.
import { bootDb, type BootDbResult } from './db/index.js'
import { buildSttStack } from './stt/index.js'
import { buildInjectionStack } from './injection/index.js'
import { registerHistoryIpcHandlers } from './ipc/history-handlers.js'
import { registerVocabIpcHandlers } from './ipc/vocab-handlers.js'
import { registerSttIpcHandlers } from './ipc/stt-handlers.js'
import { registerInjectionIpcHandlers } from './ipc/injection-handlers.js'

const log = createLogger('main')

// Enforce single instance — uIOhook + tray with two copies = chaos.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log.warn('another flowtype instance is already running — exiting')
  app.quit()
}

app.on('second-instance', () => {
  // Surface the existing instance instead of starting a new one.
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.isMinimized()) w.restore()
    if (!w.isDestroyed()) w.show()
  }
})

app.whenReady().then(async () => {
  app.setAppUserModelId('com.flowtype.app')

  // Grant microphone permission silently — single-user desktop app.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    if (permission === 'media') return cb(true)
    cb(false)
  })

  log.info('flowtype booting', {
    autostart: startedFromLogin(),
    logFile: getLogFilePath(),
    electronVersion: process.versions.electron
  })

  // Reconcile persisted setting vs OS truth.
  const osAutostart = isAutoStartEnabled()
  if (settings.get('auto_start') !== osAutostart) {
    settings.set('auto_start', osAutostart)
  }
  if (settings.get('auto_start')) {
    setAutoStart(true)
  }

  registerIpcHandlers()

  // Wire backend stacks (best-effort — see wireBackend() doc).
  wireBackend()

  const startHidden = startedFromLogin()

  // Always create overlay + tray; main window may stay hidden.
  createOverlayWindow()
  createTray()
  createMainWindow({ startHidden: true }) // creates but doesn't show

  if (!startHidden) {
    // Main window stays hidden on boot (WO-1 spec). Showing happens via tray
    // or `app:show-main` IPC. Only autostart explicitly bypasses splash, but
    // the hidden-by-default rule is the same either way.
    // We keep it created so it can be revealed cheaply on first tray click.
  }

  // Wire hotkey → overlay state + broadcasts. Skipped under E2E
  // (`FLOWTYPE_DISABLE_HOTKEY=1`) so test runs don't hijack the host's
  // Right Ctrl key.
  if (process.env.FLOWTYPE_DISABLE_HOTKEY === '1') {
    log.info('hotkey manager disabled via FLOWTYPE_DISABLE_HOTKEY')
  } else {
  hotkeyManager.init({
    onArmed: () => {
      if (settings.get('muted') || isPaused()) {
        log.debug('hotkey armed ignored (muted or paused)')
        return
      }
      broadcastOverlayState({ state: 'armed' })
      // hwndSnapshot is null in WO-1 — WO-3 fills it via PowerShell.
      broadcastHotkeyArmed({ hwndSnapshot: null })
    },
    onReleased: ({ holdDurationMs }) => {
      if (settings.get('muted') || isPaused()) return
      // WO-1 doesn't run STT — we just return to idle. WO-2 will set the
      // overlay to 'processing' until the cascade completes.
      broadcastOverlayState({ state: 'idle' })
      broadcastHotkeyReleased({ holdDurationMs, hwndSnapshot: null })
    }
  })
  } // /FLOWTYPE_DISABLE_HOTKEY guard

  log.info('flowtype boot complete', {
    hotkeyMode:
      process.env.FLOWTYPE_DISABLE_HOTKEY === '1' ? 'disabled-env' : hotkeyManager.getMode()
  })
})

// On Windows, closing the last visible window must NOT quit the app — we
// keep running in the tray. The tray "Sair" item is the only legitimate
// quit path.
app.on('window-all-closed', () => {
  // intentionally a no-op on Windows; on macOS we'd also keep going.
  log.debug('window-all-closed event ignored — staying alive in tray')
})

app.on('before-quit', () => {
  log.info('app before-quit')
})

app.on('will-quit', () => {
  log.info('app will-quit — shutting down')
  hotkeyManager.shutdown()
  destroyTray()
})

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { message: err.message, stack: err.stack })
})

process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', { reason: String(reason) })
})

/**
 * Wire WO-2/3/4/6 IPC handlers. Each step is independently guarded — if
 * better-sqlite3 fails to load (e.g. Node ABI mismatch in CI), the UI still
 * boots and the user sees friendly "feature unavailable" states instead of
 * a crashed Electron process.
 */
let backendBoot: { db?: BootDbResult } = {}
function wireBackend(): void {
  try {
    const boot = bootDb()
    backendBoot.db = boot
    log.info('bootDb ok')

    try {
      registerHistoryIpcHandlers({ repo: boot.transcriptionRepo })
    } catch (e) {
      log.error('history-handlers registration failed', { error: String(e) })
    }
    try {
      registerVocabIpcHandlers({ repo: boot.vocabRepo })
    } catch (e) {
      log.error('vocab-handlers registration failed', { error: String(e) })
    }

    // STT stack — Groq pool + provider + faster-whisper. No native deps here
    // beyond what better-sqlite3 already imposed.
    try {
      const stt = buildSttStack(
        boot.groqSlotMetaRepo,
        boot.tokenUsageRepo,
        boot.settingsRepo
      )
      registerSttIpcHandlers({
        pool: stt.pool,
        gateway: stt.gateway,
        settings: boot.settingsRepo
      })
      log.info('STT stack wired')
    } catch (e) {
      log.error('STT stack wiring failed', { error: String(e) })
    }

    // Injection stack — pulls in nut.js (native). Failure here only disables
    // paste; user can still review history and adjust settings. Skipped
    // under FLOWTYPE_DISABLE_INJECTION=1 for E2E runs.
    if (process.env.FLOWTYPE_DISABLE_INJECTION === '1') {
      log.info('Injection stack skipped via FLOWTYPE_DISABLE_INJECTION')
    } else {
      try {
        const injection = buildInjectionStack(boot.settingsRepo)
        registerInjectionIpcHandlers({
          injector: injection.injector,
          detector: injection.detector
        })
        log.info('Injection stack wired')
      } catch (e) {
        log.error('Injection stack wiring failed', { error: String(e) })
      }
    }
  } catch (e) {
    log.error('bootDb failed — running in degraded mode (no DB-backed features)', {
      error: String(e)
    })
    registerStubBackendHandlers()
  }
}

/**
 * Last-resort stubs for STT/history/vocab IPC channels when the real
 * backend cannot boot (e.g. better-sqlite3 ABI mismatch in CI). These
 * answer with safe empty values so the renderer never throws on a missing
 * handler. The real handlers replace these via `ipcMain.handle` re-register
 * if `wireBackend()` is called again later — but in practice bootDb either
 * works or doesn't for the lifetime of the app.
 */
function registerStubBackendHandlers(): void {
  // Lazy import to avoid pulling electron at module top.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ipcMain } = require('electron')

  const safeHandle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    try {
      ipcMain.handle(channel, fn)
    } catch {
      // Already registered (unlikely in degraded mode but defensive)
    }
  }

  // STT stubs
  safeHandle('stt:get-provider-settings', () => ({
    stt_force_local: false,
    stt_language: null,
    slots: {
      slots: [
        { slotIndex: 0, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null },
        { slotIndex: 1, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null },
        { slotIndex: 2, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null }
      ],
      onlineCount: 0,
      totalCount: 3
    }
  }))
  let forceLocal = false
  let language: string | null = null
  safeHandle('stt:set-force-local', (_e: unknown, enabled: boolean) => {
    forceLocal = !!enabled
    return { ok: true }
  })
  safeHandle('stt:set-language', (_e: unknown, lang: string | null) => {
    language = lang ?? null
    return { ok: true }
  })
  // Re-register get-provider-settings to read mutable state.
  try {
    ipcMain.removeHandler('stt:get-provider-settings')
  } catch {
    // noop
  }
  safeHandle('stt:get-provider-settings', () => ({
    stt_force_local: forceLocal,
    stt_language: language,
    slots: {
      slots: [
        { slotIndex: 0, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null },
        { slotIndex: 1, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null },
        { slotIndex: 2, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null }
      ],
      onlineCount: 0,
      totalCount: 3
    }
  }))
  safeHandle('stt:pool-snapshot', () => ({
    slots: [
      { slotIndex: 0, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null },
      { slotIndex: 1, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null },
      { slotIndex: 2, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null }
    ],
    onlineCount: 0,
    totalCount: 3
  }))
  safeHandle('stt:add-slot', () => ({ ok: false, validation: { valid: false, error: 'backend unavailable', latencyMs: 0 } }))
  safeHandle('stt:update-slot', () => ({ ok: false, validation: { valid: false, error: 'backend unavailable', latencyMs: 0 } }))
  safeHandle('stt:remove-slot', () => ({ ok: true }))
  safeHandle('stt:test-slot', () => ({ valid: false, error: 'backend unavailable', latencyMs: 0 }))
  safeHandle('stt:test-transcribe', () => {
    throw new Error('backend unavailable')
  })

  // History stubs
  safeHandle('history:list', () => ({ rows: [], total: 0 }))
  safeHandle('history:search', () => ({ rows: [], total: 0 }))
  safeHandle('history:get-by-id', () => null)
  safeHandle('history:update', () => ({ ok: false, error: 'backend unavailable' }))
  safeHandle('history:delete', () => ({ ok: true }))
  safeHandle('history:export', (_e: unknown, req: { format: 'md' | 'json' }) => {
    if (req?.format === 'json') {
      return { format: 'json', content: '[]' }
    }
    return {
      format: 'md',
      content: '# flowtype — histórico de transcrições\n\n_(backend unavailable)_\n'
    }
  })

  // Vocab stubs (in-memory for tests)
  type VocabEntry = {
    id: string
    term_wrong: string
    term_correct: string
    case_sensitive: boolean
    scope: string
  }
  const vocab: VocabEntry[] = []
  safeHandle('vocab:list', () => vocab)
  safeHandle('vocab:add', (_e: unknown, entry: {
    term_wrong: string
    term_correct: string
    case_sensitive?: boolean
    scope?: string
  }) => {
    const id = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const e: VocabEntry = {
      id,
      term_wrong: entry.term_wrong,
      term_correct: entry.term_correct,
      case_sensitive: !!entry.case_sensitive,
      scope: entry.scope ?? 'global'
    }
    vocab.push(e)
    return e
  })
  safeHandle('vocab:update', (_e: unknown, patch: { id: string; [k: string]: unknown }) => {
    const idx = vocab.findIndex((v) => v.id === patch.id)
    if (idx < 0) return null
    vocab[idx] = { ...vocab[idx], ...patch } as VocabEntry
    return vocab[idx]
  })
  safeHandle('vocab:remove', (_e: unknown, id: string) => {
    const idx = vocab.findIndex((v) => v.id === id)
    if (idx >= 0) vocab.splice(idx, 1)
    return { ok: true }
  })

  log.warn('stub backend handlers registered — feature surfaces respond with safe empty values')
}
