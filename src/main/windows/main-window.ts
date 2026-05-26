/**
 * Main window — hidden by default. Opens on demand via tray "Abrir flowtype"
 * or IPC `app:show-main`. Closing minimizes to tray instead of quitting.
 */

import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { createLogger } from '@shared/logger'
import { getWindowState, resolveSafePosition, trackWindow } from '../state/window-state'

const log = createLogger('main-window')

const DEFAULT_SIZE = { width: 480, height: 720 }

let mainWindow: BrowserWindow | null = null
let allowClose = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createMainWindow(opts: { startHidden: boolean }): BrowserWindow {
  const existing = getMainWindow()
  if (existing) return existing

  const rec = getWindowState('main')
  const safe = resolveSafePosition(rec, DEFAULT_SIZE)

  mainWindow = new BrowserWindow({
    width: safe.width,
    height: safe.height,
    x: safe.x,
    y: safe.y,
    minWidth: 480,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#060708',
    title: 'flowtype',
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/main.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!opts.startHidden) {
      mainWindow?.show()
      if (safe.maximized) mainWindow?.maximize()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Closing minimizes to tray unless an explicit quit was issued.
  mainWindow.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault()
      mainWindow?.hide()
      log.info('main-window close intercepted → minimized to tray')
    }
  })

  trackWindow(mainWindow, 'main')

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(`${devUrl}/index.html`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export function showMainWindow(): void {
  const win = getMainWindow()
  if (!win) {
    createMainWindow({ startHidden: false })
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function hideMainWindow(): void {
  getMainWindow()?.hide()
}

export function allowMainClose(): void {
  allowClose = true
}
