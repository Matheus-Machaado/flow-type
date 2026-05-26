/**
 * Centralized logger. File transport for main process; console for renderers.
 * Lesson `feedback_no_dev_leaks_in_ui` applied: never log to UI surfaces.
 *
 * We avoid pino transports here to keep the bundle simple and work the same
 * in dev vs prod. Log file lives at %APPDATA%/flowtype/logs/flowtype.log.
 */

import { mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB before rotate

let logDir: string | null = null
let logFile: string | null = null
let initialized = false

function ensureInit(): void {
  if (initialized) return
  try {
    // Lazy import — keep this module renderer-safe (renderer falls back to console).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron')
    const appPath: string = electron.app.getPath('userData')
    logDir = join(appPath, 'logs')
    mkdirSync(logDir, { recursive: true })
    logFile = join(logDir, 'flowtype.log')
  } catch {
    // Not in main process — renderer. Skip file I/O.
    logDir = null
    logFile = null
  }
  initialized = true
}

function rotateIfNeeded(): void {
  if (!logFile) return
  try {
    const s = statSync(logFile)
    if (s.size > MAX_BYTES) {
      renameSync(logFile, `${logFile}.1`)
    }
  } catch {
    // file not yet created
  }
}

function fileWrite(level: LogLevel, scope: string, msg: string, extra?: unknown): void {
  ensureInit()
  if (!logFile) return
  rotateIfNeeded()
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(extra !== undefined ? { extra } : {})
  })
  try {
    appendFileSync(logFile, line + '\n')
  } catch {
    // ignore — fall back to console
  }
}

export interface Logger {
  debug: (msg: string, extra?: unknown) => void
  info: (msg: string, extra?: unknown) => void
  warn: (msg: string, extra?: unknown) => void
  error: (msg: string, extra?: unknown) => void
  child: (scope: string) => Logger
}

export function createLogger(scope: string): Logger {
  const make = (level: LogLevel) => (msg: string, extra?: unknown) => {
    fileWrite(level, scope, msg, extra)
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(`[${scope}] ${msg}`, extra ?? '')
    } else if (level === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(`[${scope}] ${msg}`, extra ?? '')
    } else if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[${scope}] ${msg}`, extra ?? '')
    }
  }
  return {
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    child: (sub: string) => createLogger(`${scope}:${sub}`)
  }
}

export function getLogFilePath(): string | null {
  ensureInit()
  return logFile
}
