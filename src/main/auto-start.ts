/**
 * Wraps `app.setLoginItemSettings` for the auto-start toggle.
 * When enabled, app launches at Windows login with `--autostart` arg so
 * the boot path stays hidden (no main window pops up).
 */

import { app } from 'electron'
import { createLogger } from '@shared/logger'

const log = createLogger('auto-start')

export const AUTOSTART_FLAG = '--autostart'

export function setAutoStart(enabled: boolean): { openAtLogin: boolean } {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: enabled,
    args: enabled ? [AUTOSTART_FLAG] : []
  })
  const live = app.getLoginItemSettings()
  log.info('auto-start updated', { requested: enabled, openAtLogin: live.openAtLogin })
  return { openAtLogin: live.openAtLogin }
}

export function isAutoStartEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

export function startedFromLogin(argv: string[] = process.argv): boolean {
  return argv.includes(AUTOSTART_FLAG)
}
