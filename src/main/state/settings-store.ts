/**
 * Minimal settings store for WO-1 (hotkey, overlay position, mute, auto-start,
 * first_run_completed). Lives at %APPDATA%/flowtype/settings.json.
 *
 * WO-6 (SQLite) will absorb this into the `settings` table; until then, we
 * keep the IPC surface the same so other agents can wire UI against it.
 */

import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createLogger } from '@shared/logger'
import type { Wo1Settings, OverlayPosition } from '@shared/ipc-types'

const log = createLogger('settings-store')

const DEFAULTS: Wo1Settings = {
  hotkey: 'Right Ctrl',
  hotkey_hold_min_ms: 150,
  overlay_position: 'br',
  overlay_idle_opacity: 0.45,
  auto_start: false,
  muted: false,
  first_run_completed: false
}

let cache: Record<string, unknown> | null = null
let filePath: string | null = null
const listeners = new Set<(key: string, value: unknown) => void>()

function ensurePath(): string {
  if (filePath) return filePath
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  filePath = join(dir, 'settings.json')
  return filePath
}

function load(): Record<string, unknown> {
  if (cache) return cache
  const p = ensurePath()
  if (!existsSync(p)) {
    cache = { ...DEFAULTS } as Record<string, unknown>
    return cache
  }
  try {
    const raw = readFileSync(p, 'utf-8')
    cache = { ...DEFAULTS, ...JSON.parse(raw) } as Record<string, unknown>
  } catch (e) {
    log.warn('failed to parse settings.json — starting from defaults', { error: String(e) })
    cache = { ...DEFAULTS } as Record<string, unknown>
  }
  return cache!
}

function flush(): void {
  if (!cache) return
  const p = ensurePath()
  try {
    writeFileSync(p, JSON.stringify(cache, null, 2), 'utf-8')
  } catch (e) {
    log.error('failed to persist settings.json', { error: String(e) })
  }
}

export function getAll(): Wo1Settings {
  return load() as unknown as Wo1Settings
}

export function get<K extends keyof Wo1Settings>(key: K): Wo1Settings[K] {
  return (load() as unknown as Wo1Settings)[key]
}

export function set<K extends keyof Wo1Settings>(key: K, value: Wo1Settings[K]): void {
  const map = load()
  const before = map[key]
  if (before === value) return
  map[key] = value as unknown
  flush()
  for (const l of listeners) {
    try {
      l(key, value)
    } catch (e) {
      log.error('settings listener crashed', { error: String(e) })
    }
  }
}

export function onChange(fn: (key: string, value: unknown) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function isValidOverlayPosition(v: unknown): v is OverlayPosition {
  return typeof v === 'string' && ['br', 'bl', 'tr', 'tl', 'custom'].includes(v)
}
