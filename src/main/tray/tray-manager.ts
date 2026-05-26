/**
 * Tray icon + context menu. Provides the only user-visible entry point when
 * the main window is hidden. Double-click restores the main window;
 * right-click opens the context menu.
 */

import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createLogger } from '@shared/logger'
import * as settings from '../state/settings-store'
import { setOverlayVisible } from '../windows/overlay-window'
import { showMainWindow, allowMainClose } from '../windows/main-window'

const log = createLogger('tray-manager')

let tray: Tray | null = null
let paused = false

function buildIcon(): Electron.NativeImage {
  // Try resource file first; fallback to a programmatically-generated 16x16 dot.
  const candidates = [
    join(__dirname, '../../resources/tray-icon.png'),
    join(__dirname, '../../../resources/tray-icon.png'),
    join(process.resourcesPath ?? '', 'tray-icon.png')
  ]
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) return img
      }
    } catch {
      /* try next */
    }
  }
  // Fallback: empty image — Electron will show a blank but functional tray slot.
  log.warn('tray icon resource not found — using empty placeholder')
  return nativeImage.createEmpty()
}

function buildMenu(): Menu {
  const muted = settings.get('muted')
  return Menu.buildFromTemplate([
    {
      label: 'Abrir flowtype',
      click: () => showMainWindow()
    },
    {
      label: 'Histórico',
      click: () => {
        log.info('history menu clicked (placeholder — WO-4)')
        showMainWindow()
      }
    },
    {
      label: 'Settings',
      click: () => {
        log.info('settings menu clicked (placeholder — WO-4)')
        showMainWindow()
      }
    },
    { type: 'separator' },
    {
      label: paused ? 'Retomar (overlay visível)' : 'Pausar (overlay invisível)',
      click: () => togglePause()
    },
    {
      label: muted ? 'Desativar mudo' : 'Silenciar (mute hotkey)',
      click: () => {
        const next = !settings.get('muted')
        settings.set('muted', next)
        refresh()
      }
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        log.info('quit requested via tray')
        allowMainClose()
        app.quit()
      }
    }
  ])
}

export function createTray(): Tray {
  if (tray) return tray
  tray = new Tray(buildIcon())
  tray.setToolTip('flowtype — voz vira texto onde você estiver')
  tray.setContextMenu(buildMenu())

  tray.on('double-click', () => showMainWindow())

  // On Windows, left-click should NOT open the menu (per WO-1: open Settings
  // later). For v0.1 it restores the main window.
  tray.on('click', () => showMainWindow())

  log.info('tray created')
  return tray
}

export function refresh(): void {
  tray?.setContextMenu(buildMenu())
}

export function togglePause(): void {
  paused = !paused
  setOverlayVisible(!paused)
  refresh()
  log.info('overlay pause toggled', { paused })
}

export function isPaused(): boolean {
  return paused
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
