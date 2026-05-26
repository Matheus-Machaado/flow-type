/**
 * ActiveWindowDetector — implementação Windows-primary via PowerShell.
 *
 * Cobre e3-active-window-detection (ADR-11).
 *
 * Estratégia:
 *  - Spawn `powershell -NoProfile -Command <SCRIPT>` onde SCRIPT é Add-Type
 *    inline com P/Invoke pra GetForegroundWindow + GetWindowText +
 *    GetWindowThreadProcessId + Process.GetProcessById.
 *  - Output JSON one-line `{ exeName, windowTitle, processId, hwnd }`.
 *  - Cache em memória ~100ms (sob load — paste sequencial dispara
 *    getActiveWindow várias vezes — cache evita overhead do PowerShell).
 *  - Timeout 500ms (configurável).
 *  - Em macOS/Linux retorna null + log warning (não suportado v0.1).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';
import type { WindowDetector, WindowInfo } from './injection-types.js';

const execFileP = promisify(execFile);

const DEFAULT_CACHE_TTL_MS = 100;
const DEFAULT_TIMEOUT_MS = 500;

/**
 * Script PowerShell inline. Add-Type compila um wrapper C# pequeno com 4
 * P/Invokes do user32.dll; depois invoca e produz JSON em STDOUT.
 *
 * Observações:
 *  - $pid é reserved em PowerShell — usamos $procId.
 *  - ProcessName não inclui ".exe" — concatenamos pra normalizar.
 *  - ErrorAction Stop em Get-Process pra cair pro catch (proc morto entre frames).
 */
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FlowtypeWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
}
"@
$hwnd = [FlowtypeWin]::GetForegroundWindow()
$procId = 0
[void][FlowtypeWin]::GetWindowThreadProcessId($hwnd, [ref]$procId)
$len = [FlowtypeWin]::GetWindowTextLength($hwnd)
$sb = New-Object System.Text.StringBuilder ($len + 1)
[void][FlowtypeWin]::GetWindowText($hwnd, $sb, $sb.Capacity)
$title = $sb.ToString()
try {
  $proc = Get-Process -Id $procId -ErrorAction Stop
  $exe = $proc.ProcessName.ToLower() + ".exe"
} catch { $exe = "" }
$out = @{ exeName=$exe; windowTitle=$title; processId=$procId; hwnd=[int64]$hwnd } | ConvertTo-Json -Compress
Write-Output $out
`.trim();

export interface ActiveWindowDetectorOptions {
  /** TTL do cache em ms (default 100). */
  cacheTtlMs?: number;
  /** Timeout do PowerShell em ms (default 500). */
  timeoutMs?: number;
  /** Override do executor (test injection). */
  execFn?: (cmd: string, args: string[], opts: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;
  /** Override do clock (test injection). */
  now?: () => number;
  /** Override da plataforma (test injection). */
  platform?: NodeJS.Platform;
}

interface CacheEntry {
  result: WindowInfo | null;
  expiresAt: number;
}

export class ActiveWindowDetector implements WindowDetector {
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly platform: NodeJS.Platform;
  private readonly execFn: (
    cmd: string,
    args: string[],
    opts: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  private cache: CacheEntry | null = null;
  /** Promise-cache pra deduplicar chamadas concorrentes (1 PowerShell por janela). */
  private inFlight: Promise<WindowInfo | null> | null = null;

  constructor(opts: ActiveWindowDetectorOptions = {}) {
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = opts.now ?? (() => Date.now());
    this.platform = opts.platform ?? process.platform;
    this.execFn =
      opts.execFn ??
      (async (cmd, args, o) => {
        const { stdout, stderr } = await execFileP(cmd, args, {
          timeout: o.timeout,
          windowsHide: true,
          maxBuffer: 64 * 1024,
        });
        return { stdout: String(stdout), stderr: String(stderr) };
      });
  }

  /** Snapshot da janela em foco (cached). */
  async getActiveWindow(): Promise<WindowInfo | null> {
    if (this.platform !== 'win32') {
      logger.warn({
        event: 'injection.active_window.unsupported_platform',
        platform: this.platform,
      });
      return null;
    }

    const now = this.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.result;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.runPowerShell()
      .then((result) => {
        this.cache = { result, expiresAt: this.now() + this.cacheTtlMs };
        return result;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  /** Invalida cache (útil em testes ou após eventos de mudança de janela). */
  invalidateCache(): void {
    this.cache = null;
  }

  private async runPowerShell(): Promise<WindowInfo | null> {
    try {
      const { stdout } = await this.execFn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
        { timeout: this.timeoutMs },
      );
      return parseWindowInfo(stdout);
    } catch (err) {
      logger.warn({
        event: 'injection.active_window.detect_failed',
        error: (err as Error).message,
      });
      return null;
    }
  }
}

/**
 * Parse do JSON one-line emitido pelo script PowerShell.
 * Exportado pra teste unitário sem precisar mockar exec.
 */
export function parseWindowInfo(stdout: string): WindowInfo | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<{
      exeName: unknown;
      windowTitle: unknown;
      processId: unknown;
      hwnd: unknown;
    }>;
    const hwnd = typeof parsed.hwnd === 'number' ? parsed.hwnd : Number(parsed.hwnd ?? 0);
    const processId =
      typeof parsed.processId === 'number' ? parsed.processId : Number(parsed.processId ?? 0);
    const exeName = String(parsed.exeName ?? '').toLowerCase();
    const windowTitle = String(parsed.windowTitle ?? '');
    if (!Number.isFinite(hwnd) || hwnd <= 0) return null;
    return { hwnd, exeName, windowTitle, processId };
  } catch (err) {
    logger.warn({
      event: 'injection.active_window.parse_failed',
      error: (err as Error).message,
      stdout: trimmed.slice(0, 120),
    });
    return null;
  }
}

export { PS_SCRIPT as POWERSHELL_DETECT_SCRIPT };
