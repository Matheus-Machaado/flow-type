/**
 * IPC handlers para a camada de injeção de texto + active window.
 *
 * Canais expostos (alinhados com internal-contracts.md §1):
 *   text-injection:paste            invoke  → PasteResult
 *   text-injection:result           event   broadcast pra overlay + main renderer
 *   app:active-window               invoke  → WindowInfo | null
 *
 * Mantemos o módulo independente pra não criar cyclic deps com ipc-router.
 * Registro: registerInjectionIpcHandlers({ injector, detector }) chamado em
 * src/main/index.ts depois do registerIpcHandlers() do WO-1.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { logger } from '../utils/logger.js';
import type { TextInjector } from '../injection/text-injector.js';
import type { ActiveWindowDetector } from '../injection/active-window-detector.js';
import type { PasteResult, WindowInfo } from '../injection/injection-types.js';

export const InjectionChannels = {
  Paste: 'text-injection:paste',
  Result: 'text-injection:result',
  ActiveWindow: 'app:active-window',
  ActiveWindowDetectOnce: 'app:active-window-detect-once',
} as const;

export interface PastePayload {
  text: string;
}

export interface InjectionIpcDeps {
  injector: TextInjector;
  detector: ActiveWindowDetector;
  /** Override pra testes: broadcaster pro overlay/main renderer. */
  broadcastResult?: (result: PasteResult) => void;
}

export function registerInjectionIpcHandlers(deps: InjectionIpcDeps): void {
  // ── text-injection:paste ─────────────────────────────────────────
  ipcMain.handle(InjectionChannels.Paste, async (_e, payload: PastePayload) => {
    const result = await deps.injector.paste(payload?.text ?? '');
    broadcast(result, deps.broadcastResult);
    return result;
  });

  // ── app:active-window ─────────────────────────────────────────────
  // Override do stub do WO-1: removemos e re-registramos.
  ipcMain.removeHandler('app:active-window');
  ipcMain.handle(InjectionChannels.ActiveWindow, async (): Promise<WindowInfo | null> => {
    return deps.detector.getActiveWindow();
  });

  ipcMain.handle(
    InjectionChannels.ActiveWindowDetectOnce,
    async (): Promise<WindowInfo | null> => {
      deps.detector.invalidateCache();
      return deps.detector.getActiveWindow();
    },
  );

  logger.info({
    event: 'injection.ipc.handlers_registered',
    channels: Object.values(InjectionChannels),
  });
}

function broadcast(result: PasteResult, override?: (r: PasteResult) => void): void {
  if (override) {
    override(result);
    return;
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send(InjectionChannels.Result, result);
    }
  }
}
