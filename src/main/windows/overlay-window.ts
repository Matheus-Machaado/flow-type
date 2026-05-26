/**
 * Overlay window — transparent, frameless, always-on-top, click-through-safe.
 * Anchored to one of the 4 screen corners based on `overlay_position` setting.
 * Receives state updates via IPC (see ipc-router.ts).
 */

import { BrowserWindow, screen, Display } from 'electron'
import { join } from 'node:path'
import { createLogger } from '@shared/logger'
import * as settings from '../state/settings-store'
import type { OverlayPosition } from '@shared/ipc-types'

const log = createLogger('overlay-window')

export const OVERLAY_W = 200
export const OVERLAY_H = 64
const MARGIN = 16

let overlayWindow: BrowserWindow | null = null

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

function computePosition(
  display: Display,
  position: OverlayPosition,
  custom?: [number, number]
): { x: number; y: number } {
  if (position === 'custom' && custom) {
    return { x: custom[0], y: custom[1] }
  }
  const wa = display.workArea
  switch (position) {
    case 'tl':
      return { x: wa.x + MARGIN, y: wa.y + MARGIN }
    case 'tr':
      return { x: wa.x + wa.width - OVERLAY_W - MARGIN, y: wa.y + MARGIN }
    case 'bl':
      return { x: wa.x + MARGIN, y: wa.y + wa.height - OVERLAY_H - MARGIN }
    case 'br':
    default:
      return {
        x: wa.x + wa.width - OVERLAY_W - MARGIN,
        y: wa.y + wa.height - OVERLAY_H - MARGIN
      }
  }
}

export function createOverlayWindow(): BrowserWindow {
  const existing = getOverlayWindow()
  if (existing) return existing

  const pos = settings.get('overlay_position')
  const custom = settings.get('overlay_custom_xy') as [number, number] | undefined
  const display = screen.getPrimaryDisplay()
  const { x, y } = computePosition(display, pos, custom)

  overlayWindow = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_H,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    type: 'toolbar',
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  // Push above fullscreen apps (Win/Mac).
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.showInactive()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    overlayWindow.loadURL(`${devUrl}/overlay.html`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  // Reposition on display changes.
  screen.on('display-metrics-changed', repositionOverlay)
  screen.on('display-added', repositionOverlay)
  screen.on('display-removed', repositionOverlay)

  // Persist user-drag position: switch setting to 'custom' and remember xy.
  // Debounce to once per move-stop event.
  let moveTimer: NodeJS.Timeout | null = null
  overlayWindow.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      const win = getOverlayWindow()
      if (!win) return
      const bounds = win.getBounds()
      settings.set('overlay_position', 'custom')
      settings.set('overlay_custom_xy', [bounds.x, bounds.y])
      log.debug('overlay position persisted via drag', { x: bounds.x, y: bounds.y })
    }, 250)
  })

  log.info('overlay-window created', { x, y, pos })
  return overlayWindow
}

export function repositionOverlay(): void {
  const win = getOverlayWindow()
  if (!win) return
  const pos = settings.get('overlay_position')
  const custom = settings.get('overlay_custom_xy') as [number, number] | undefined
  const display = screen.getPrimaryDisplay()
  const { x, y } = computePosition(display, pos, custom)
  win.setBounds({ x, y, width: OVERLAY_W, height: OVERLAY_H })
}

export function setOverlayVisible(visible: boolean): void {
  const win = getOverlayWindow()
  if (!win) return
  if (visible) win.showInactive()
  else win.hide()
}
