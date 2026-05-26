/**
 * flowtype main process entry. Wires the modules: window-state, settings,
 * overlay, main window, tray, hotkey, IPC handlers, auto-start, and the
 * full hotkey → record → STT → vocab → inject → history pipeline.
 *
 * v0.1.1: full integration. Overlay records audio while hotkey is held,
 * sends the buffer to main on release, main runs SttGateway whose
 * onTranscribed hook chains text injection + history persistence + badge.
 */

import { app, BrowserWindow, ipcMain, session } from 'electron'
import { createLogger, getLogFilePath } from '@shared/logger'
import { Channels } from '@shared/ipc-types'

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
import { buildSttStack, type SttStack } from './stt/index.js'
import { buildInjectionStack, type InjectionStack } from './injection/index.js'
import { registerHistoryIpcHandlers } from './ipc/history-handlers.js'
import { registerVocabIpcHandlers } from './ipc/vocab-handlers.js'
import { registerSttIpcHandlers } from './ipc/stt-handlers.js'
import { registerInjectionIpcHandlers } from './ipc/injection-handlers.js'
import { audioPathFor } from './utils/audio-path.js'
import { newId as newUlid } from './utils/ulid.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

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

  // Always create overlay + tray; main window may stay hidden.
  createOverlayWindow()
  createTray()
  createMainWindow({ startHidden: true })

  // Wire hotkey → broadcast events to ALL windows (overlay drives recording).
  // Skipped under E2E (`FLOWTYPE_DISABLE_HOTKEY=1`) so test runs don't hijack
  // the host's Right Ctrl key.
  if (process.env.FLOWTYPE_DISABLE_HOTKEY === '1') {
    log.info('hotkey manager disabled via FLOWTYPE_DISABLE_HOTKEY')
  } else {
    hotkeyManager.init({
      onArmed: () => {
        if (settings.get('muted') || isPaused()) {
          log.debug('hotkey armed ignored (muted or paused)')
          return
        }
        // Visual: overlay → armed (animation only; recording starts on overlay
        // when it sees hotkey:armed).
        broadcastOverlayState({ state: 'armed' })
        broadcastHotkeyArmed({ hwndSnapshot: null })
      },
      onReleased: ({ holdDurationMs }) => {
        if (settings.get('muted') || isPaused()) return
        // Visual: overlay → processing (overlay flips to processing right
        // after stopping its MediaRecorder, before the audio buffer arrives).
        // Broadcasting here makes the transition feel instant from the user's
        // POV even if the overlay's own state update lags a tick.
        broadcastOverlayState({ state: 'processing', meta: { label: 'transcrevendo…' } })
        broadcastHotkeyReleased({ holdDurationMs, hwndSnapshot: null })
      }
    })
  }

  log.info('flowtype boot complete', {
    hotkeyMode:
      process.env.FLOWTYPE_DISABLE_HOTKEY === '1' ? 'disabled-env' : hotkeyManager.getMode()
  })
})

// On Windows, closing the last visible window must NOT quit the app — we
// keep running in the tray.
app.on('window-all-closed', () => {
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

// ─────────────────────────────────────────────────────────────────────────
// Backend wiring
// ─────────────────────────────────────────────────────────────────────────

let backendBoot: {
  db?: BootDbResult
  stt?: SttStack
  injection?: InjectionStack
} = {}

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

    // Injection stack BEFORE STT so the gateway's onTranscribed hook can
    // call injector.paste() and persist via transcriptionRepo.insert().
    // Skipped under FLOWTYPE_DISABLE_INJECTION=1 for E2E runs.
    let injection: InjectionStack | undefined
    if (process.env.FLOWTYPE_DISABLE_INJECTION === '1') {
      log.info('Injection stack skipped via FLOWTYPE_DISABLE_INJECTION')
    } else {
      try {
        injection = buildInjectionStack(boot.settingsRepo)
        backendBoot.injection = injection
        registerInjectionIpcHandlers({
          injector: injection.injector,
          detector: injection.detector
        })
        log.info('Injection stack wired')
      } catch (e) {
        log.error('Injection stack wiring failed', { error: String(e) })
      }
    }

    // STT stack — with onTranscribed hook bound to injector + transcription
    // repo + overlay badge. This is the integration glue that v0.1.0 missed.
    try {
      const stt = buildSttStack(
        boot.groqSlotMetaRepo,
        boot.tokenUsageRepo,
        boot.settingsRepo,
        {
          gatewayOptions: {
            vocabRepo: boot.vocabRepo,
            resolveActiveExe: () => {
              // v0.1.1: returns undefined → vocab uses global scope only.
              // Per-app scope requires sync access to the detector cache;
              // ActiveWindowDetector currently exposes only async. Will be
              // wired in v0.1.2 once detector gets a sync `getLastKnownExe()`.
              return undefined
            },
            broadcastBadge: (badgeEvent) => {
              for (const w of BrowserWindow.getAllWindows()) {
                if (w.isDestroyed()) continue
                w.webContents.send(Channels.OverlayShowBadge, {
                  kind: badgeEvent.kind,
                  slotIndex: badgeEvent.slotIndex,
                  slotLabel: badgeEvent.slotLabel,
                  latencyMs: badgeEvent.latencyMs,
                  ttlMs: badgeEvent.ttlMs ?? 1500
                })
              }
            },
            onTranscribed: async (result, _ctx) => {
              // Skip empty or whitespace-only transcripts (hold-too-short etc).
              const text = (result.text ?? '').trim()
              if (!text) {
                log.info('transcribe: empty text, skipping inject + history')
                broadcastOverlayState({ state: 'idle' })
                return
              }
              let pasteResult:
                | Awaited<ReturnType<NonNullable<typeof injection>['injector']['paste']>>
                | null = null
              let pasteError: string | null = null
              if (injection) {
                try {
                  pasteResult = await injection.injector.paste(text)
                } catch (e) {
                  pasteError = (e as Error).message
                  log.error('text-injection paste failed', { error: pasteError })
                }
              }
              try {
                const rawApplied =
                  (result as unknown as {
                    vocab_corrections_applied?: Array<{
                      id: string
                      term_wrong: string
                      term_correct: string
                      count: number
                    }>
                  }).vocab_corrections_applied ?? []
                // Map gateway's VocabApplied → repo's VocabCorrectionApplied shape.
                const vocabApplied = rawApplied.map((v) => ({
                  wrong: v.term_wrong,
                  correct: v.term_correct,
                  scope: 'global'
                }))
                const pasteMethod =
                  pasteResult?.method === 'clipboard' || pasteResult?.method === 'typing'
                    ? pasteResult.method
                    : undefined
                boot.transcriptionRepo.insert({
                  text,
                  audio_path: null,
                  app_exe: pasteResult?.targetWindow?.exeName ?? null,
                  app_window_title: pasteResult?.targetWindow?.windowTitle ?? null,
                  provider_used: result.provider,
                  slot_index: result.slotIndex ?? null,
                  slot_label: result.slotLabel ?? null,
                  latency_ms: Math.round(result.latencyMs ?? 0),
                  language: result.language ?? null,
                  vocab_corrections_applied: vocabApplied,
                  paste_method: pasteMethod,
                  paste_succeeded: pasteResult?.success ?? false,
                  target_window_lost_focus: pasteResult?.refocused ?? false
                })
              } catch (e) {
                log.error('transcription_repo.insert failed', { error: (e as Error).message })
              }
              if (pasteError) {
                log.warn('paste failed; transcription saved without inject', { pasteError })
              }
              // Final overlay state — back to idle. Badge fades on its own.
              broadcastOverlayState({ state: 'idle' })
            }
          }
        }
      )
      backendBoot.stt = stt
      registerSttIpcHandlers({
        pool: stt.pool,
        gateway: stt.gateway,
        settings: boot.settingsRepo
      })
      log.info('STT stack wired')

      // The orchestrator: overlay → main with audio buffer → full pipeline.
      ipcMain.handle(
        Channels.SttTranscribeAndInject,
        async (
          _e,
          payload: { audioBuffer: ArrayBuffer; durationMs: number }
        ): Promise<{
          ok: boolean
          error?: string
          text?: string
          provider?: 'groq' | 'local'
          latencyMs?: number
        }> => {
          try {
            if (!payload?.audioBuffer || payload.audioBuffer.byteLength < 1024) {
              log.info('transcribe-and-inject: audio too small, skipping', {
                bytes: payload?.audioBuffer?.byteLength ?? 0
              })
              broadcastOverlayState({ state: 'idle' })
              return { ok: false, error: 'audio-too-small' }
            }
            // Persist audio as artifact (best-effort — caller doesn't depend).
            try {
              const id = newUlid()
              const path = audioPathFor(id)
              await mkdir(dirname(path), { recursive: true })
              await writeFile(path, Buffer.from(payload.audioBuffer))
            } catch (e) {
              log.warn('audio persist failed (non-fatal)', { error: (e as Error).message })
            }
            const language =
              boot.settingsRepo.get<string | null>('stt_language', null) ?? undefined
            const result = await stt.gateway.transcribe(payload.audioBuffer, { language })
            return {
              ok: true,
              text: result.text,
              provider: result.provider,
              latencyMs: result.latencyMs
            }
          } catch (e) {
            const msg = (e as Error).message
            log.error('transcribe-and-inject failed', { error: msg })
            broadcastOverlayState({ state: 'idle' })
            return { ok: false, error: msg }
          }
        }
      )
      log.info('orchestrator wired (stt:transcribe-and-inject)')
    } catch (e) {
      log.error('STT stack wiring failed', { error: String(e) })
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
 * backend cannot boot. Renderer never throws on a missing handler.
 */
function registerStubBackendHandlers(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ipcMain } = require('electron')

  // Stub helper — handlers run in degraded mode, exact event typing is irrelevant.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safeHandle = (channel: string, fn: (...args: any[]) => unknown): void => {
    try {
      ipcMain.handle(channel, fn)
    } catch {
      // Already registered (defensive)
    }
  }

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
  const emptyPool = {
    slots: [
      { slotIndex: 0, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null },
      { slotIndex: 1, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null },
      { slotIndex: 2, hasKey: false, status: 'empty', usedToday: 0, dailyCap: 14400, label: null }
    ],
    onlineCount: 0,
    totalCount: 3
  }
  safeHandle('stt:get-provider-settings', () => ({
    stt_force_local: forceLocal,
    stt_language: language,
    slots: emptyPool
  }))
  safeHandle('stt:pool-snapshot', () => emptyPool)
  safeHandle('stt:add-slot', () => ({
    ok: false,
    validation: { valid: false, error: 'backend unavailable', latencyMs: 0 }
  }))
  safeHandle('stt:update-slot', () => ({
    ok: false,
    validation: { valid: false, error: 'backend unavailable', latencyMs: 0 }
  }))
  safeHandle('stt:remove-slot', () => ({ ok: true }))
  safeHandle('stt:test-slot', () => ({ valid: false, error: 'backend unavailable', latencyMs: 0 }))
  safeHandle('stt:test-transcribe', () => {
    throw new Error('backend unavailable')
  })
  safeHandle('stt:transcribe-and-inject', () => ({ ok: false, error: 'backend unavailable' }))

  // History stubs
  safeHandle('history:list', () => ({ rows: [], total: 0 }))
  safeHandle('history:search', () => ({ rows: [], total: 0 }))
  safeHandle('history:get-by-id', () => null)
  safeHandle('history:update', () => ({ ok: false, error: 'backend unavailable' }))
  safeHandle('history:delete', () => ({ ok: true }))
  safeHandle('history:export', (_e: unknown, req: { format: 'md' | 'json' }) => {
    if (req?.format === 'json') return { format: 'json', content: '[]' }
    return {
      format: 'md',
      content: '# flowtype — histórico de transcrições\n\n_(backend unavailable)_\n'
    }
  })

  // Vocab stubs
  type V = {
    id: string
    term_wrong: string
    term_correct: string
    case_sensitive: boolean
    scope: string
  }
  const vocab: V[] = []
  safeHandle('vocab:list', () => vocab)
  safeHandle('vocab:add', (_e: unknown, entry: V) => {
    const id = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const e: V = { ...entry, id, case_sensitive: !!entry.case_sensitive, scope: entry.scope ?? 'global' }
    vocab.push(e)
    return e
  })
  safeHandle('vocab:update', (_e: unknown, patch: { id: string; [k: string]: unknown }) => {
    const idx = vocab.findIndex((v) => v.id === patch.id)
    if (idx < 0) return null
    vocab[idx] = { ...vocab[idx], ...patch } as V
    return vocab[idx]
  })
  safeHandle('vocab:remove', (_e: unknown, id: string) => {
    const idx = vocab.findIndex((v) => v.id === id)
    if (idx >= 0) vocab.splice(idx, 1)
    return { ok: true }
  })

  log.warn('stub backend handlers registered — feature surfaces respond with safe empty values')
}
