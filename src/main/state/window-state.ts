/**
 * Persists window positions/sizes per logical window key ("main" | "settings" | ...).
 * Lives at %APPDATA%/flowtype/window-state.json.
 *
 * This is a temporary store for WO-1. WO-6 (SQLite) will replace it with
 * `settings` table; until then, JSON keeps the API surface stable.
 */

import { app, screen, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createLogger } from '@shared/logger'
import type { WindowStateMap, WindowStateRecord } from '@shared/ipc-types'

const log = createLogger('window-state')

let cache: WindowStateMap | null = null
let filePath: string | null = null

function ensurePath(): string {
  if (filePath) return filePath
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  filePath = join(dir, 'window-state.json')
  return filePath
}

function load(): WindowStateMap {
  if (cache) return cache
  const p = ensurePath()
  if (!existsSync(p)) {
    cache = {}
    return cache
  }
  try {
    const raw = readFileSync(p, 'utf-8')
    cache = JSON.parse(raw) as WindowStateMap
  } catch (e) {
    log.warn('failed to parse window-state.json — starting fresh', { error: String(e) })
    cache = {}
  }
  return cache
}

function flush(): void {
  if (!cache) return
  const p = ensurePath()
  try {
    writeFileSync(p, JSON.stringify(cache, null, 2), 'utf-8')
  } catch (e) {
    log.error('failed to persist window-state.json', { error: String(e) })
  }
}

export function getWindowState(key: keyof WindowStateMap): WindowStateRecord | undefined {
  return load()[key]
}

export function setWindowState(key: keyof WindowStateMap, rec: WindowStateRecord): void {
  const map = load()
  map[key] = rec
  flush()
}

export function getAllWindowStates(): WindowStateMap {
  return { ...load() }
}

/**
 * Returns a record that fits inside the current display work area.
 * Falls back to default if persisted x/y is off-screen (monitor removed).
 */
export function resolveSafePosition(
  rec: WindowStateRecord | undefined,
  defaults: { width: number; height: number }
): WindowStateRecord {
  const width = rec?.width ?? defaults.width
  const height = rec?.height ?? defaults.height
  if (rec?.x === undefined || rec?.y === undefined) {
    return { width, height, maximized: rec?.maximized }
  }
  const displays = screen.getAllDisplays()
  const fits = displays.some((d) => {
    const wa = d.workArea
    return (
      rec.x! >= wa.x &&
      rec.y! >= wa.y &&
      rec.x! + width <= wa.x + wa.width &&
      rec.y! + height <= wa.y + wa.height
    )
  })
  return fits
    ? { width, height, x: rec.x, y: rec.y, maximized: rec.maximized }
    : { width, height, maximized: rec.maximized }
}

/**
 * Attaches resize/move/close listeners to keep window-state synced.
 */
export function trackWindow(win: BrowserWindow, key: keyof WindowStateMap): void {
  const save = (): void => {
    if (win.isDestroyed()) return
    const [w, h] = win.getSize()
    const [x, y] = win.getPosition()
    setWindowState(key, {
      width: w,
      height: h,
      x,
      y,
      maximized: win.isMaximized()
    })
  }
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', save)
}
