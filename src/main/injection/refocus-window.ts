/**
 * refocusWindow — re-foca janela alvo via PowerShell SetForegroundWindow.
 *
 * Cobre e3-refocus-target-window (ADR-11).
 *
 * Pipeline:
 *  1. Captura janela ativa atual.
 *  2. Se hwnd atual === target.hwnd → no-op + return true.
 *  3. Spawn PowerShell rodando `[FlowtypeRefocus]::SetForegroundWindow(hwnd)`.
 *  4. Se falhar → tentativa fallback com AttachThreadInput workaround
 *     (Windows pode bloquear SetForegroundWindow se app caller não estava em
 *     foreground recentemente — anexar thread input dá ao caller as "permissões"
 *     de input do owner).
 *
 * Timeout: default 200ms.
 *
 * Retorno boolean:
 *  - true: foco já era do target OU SetForegroundWindow OK.
 *  - false: target null/inválido OU PowerShell timeout/falha.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';
import type { WindowInfo } from './injection-types.js';

const execFileP = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 200;

/**
 * Script PowerShell que tenta SetForegroundWindow direto + fallback
 * AttachThreadInput. Recebe o hwnd via parâmetro.
 *
 * Output: "ok" | "failed" | "fallback_ok" | "fallback_failed".
 */
const PS_SCRIPT = `
param([Parameter(Mandatory=$true)][int64]$Hwnd)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FlowtypeRefocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  [DllImport("user32.dll")] public static extern int GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(int idAttach, int idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$ptr = [IntPtr]$Hwnd
$ok = [FlowtypeRefocus]::SetForegroundWindow($ptr)
if ($ok) { Write-Output 'ok'; exit 0 }
# Fallback: AttachThreadInput workaround (caso Windows bloqueie SFW).
$fg = [FlowtypeRefocus]::GetForegroundWindow()
$proc = 0
$fgThread = [FlowtypeRefocus]::GetWindowThreadProcessId($fg, [ref]$proc)
$myThread = [FlowtypeRefocus]::GetCurrentThreadId()
[void][FlowtypeRefocus]::AttachThreadInput($myThread, $fgThread, $true)
$ok2 = [FlowtypeRefocus]::SetForegroundWindow($ptr)
[void][FlowtypeRefocus]::BringWindowToTop($ptr)
[void][FlowtypeRefocus]::ShowWindow($ptr, 5)
[void][FlowtypeRefocus]::AttachThreadInput($myThread, $fgThread, $false)
if ($ok2) { Write-Output 'fallback_ok'; exit 0 }
Write-Output 'fallback_failed'
exit 1
`.trim();

export interface RefocusWindowOptions {
  /** Timeout do PowerShell em ms (default 200). */
  timeoutMs?: number;
  /** Override do executor (test injection). */
  execFn?: (cmd: string, args: string[], opts: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;
  /** Plataforma (test injection); default = process.platform. */
  platform?: NodeJS.Platform;
  /** Override do detector pra checar se já está em foco (test injection). */
  getCurrentHwnd?: () => Promise<number | null>;
}

/**
 * Re-foca a janela alvo. Retorna true se já estava em foco OU se SetForegroundWindow OK.
 */
export async function refocusWindow(
  target: WindowInfo | null,
  opts: RefocusWindowOptions = {},
): Promise<boolean> {
  if (!target || !target.hwnd || target.hwnd <= 0) return false;

  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') {
    logger.warn({
      event: 'injection.refocus.unsupported_platform',
      platform,
    });
    return false;
  }

  // Curto-circuito: se o caller injetar `getCurrentHwnd` e ela retornar o
  // mesmo hwnd do target, evitamos o spawn do PowerShell.
  if (opts.getCurrentHwnd) {
    try {
      const current = await opts.getCurrentHwnd();
      if (current && current === target.hwnd) return true;
    } catch {
      /* segue pra refocus real */
    }
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execFn =
    opts.execFn ??
    (async (cmd, args, o) => {
      const { stdout, stderr } = await execFileP(cmd, args, {
        timeout: o.timeout,
        windowsHide: true,
        maxBuffer: 8 * 1024,
      });
      return { stdout: String(stdout), stderr: String(stderr) };
    });

  try {
    const { stdout } = await execFn(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        PS_SCRIPT,
        '-Hwnd',
        String(target.hwnd),
      ],
      { timeout: timeoutMs },
    );
    const trimmed = stdout.trim();
    if (trimmed === 'ok' || trimmed === 'fallback_ok') {
      logger.info({
        event: 'injection.refocus.ok',
        hwnd: target.hwnd,
        exe: target.exeName,
        path: trimmed,
      });
      return true;
    }
    logger.warn({
      event: 'injection.refocus.failed',
      hwnd: target.hwnd,
      exe: target.exeName,
      result: trimmed,
    });
    return false;
  } catch (err) {
    logger.warn({
      event: 'injection.refocus.timeout_or_error',
      hwnd: target.hwnd,
      exe: target.exeName,
      error: (err as Error).message,
    });
    return false;
  }
}

export { PS_SCRIPT as POWERSHELL_REFOCUS_SCRIPT };
