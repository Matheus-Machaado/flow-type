/**
 * Tipos compartilhados da camada de injeção de texto.
 *
 * Espelha `internal-contracts.md` §2.5 (TextInjector) e §2.6
 * (ActiveWindowDetector). Os erros tipados ficam aqui (não em
 * `@shared/errors`) porque são internos da camada de injection;
 * o cross-module continua usando `PasteBlockedError` e `WindowLostError`
 * do shared. Aqui adicionamos os erros operacionais específicos
 * (BlockedByPolicy, Restore, Keystroke).
 *
 * Cobre features e3-* (clipboard-paste-pipeline, active-window-detection,
 * clipboard-snapshot-restore, refocus-target-window, app-whitelist-blacklist,
 * typing-simulation-fallback, punctuation-heuristic).
 */

// ─── WindowInfo ────────────────────────────────────────────────────────

/** Snapshot da janela em foco (Windows-first; macOS/Linux retornam null). */
export interface WindowInfo {
  /** Handle nativo Windows. Em macOS/Linux fica 0. */
  hwnd: number;
  /** Nome do executável, lowercase, sem extensão (.exe omitido em Process.GetProcessById). */
  exeName: string;
  /** Título da janela (string vazia se sem título). */
  windowTitle: string;
  /** PID do processo dono. */
  processId: number;
}

// ─── ActiveWindowDetector ──────────────────────────────────────────────

export interface WindowDetector {
  /** Snapshot da janela em foco. Cache curto (~100ms) interno. */
  getActiveWindow(): Promise<WindowInfo | null>;
}

// ─── TextInjector ──────────────────────────────────────────────────────

export type InjectionMethod = 'clipboard' | 'typing';

/** Resultado do paste do TextInjector. */
export interface PasteResult {
  /** Método efetivamente usado. 'noop' quando texto vazio/whitespace. */
  method: InjectionMethod | 'noop';
  success: boolean;
  /** Janela alvo capturada no momento da chamada (pode ser null em macOS/Linux). */
  targetWindow: WindowInfo | null;
  /** true se houve necessidade de refocusWindow + sucesso na operação. */
  refocused: boolean;
  /** true se policy bloqueou (blacklist). */
  blocked?: boolean;
  /** Erro user-facing (PT-BR). */
  errorReason?: string;
  /** Wall clock do pipeline inteiro. */
  latencyMs: number;
}

export interface TextInjectorContract {
  paste(text: string): Promise<PasteResult>;
}

// ─── Clipboard snapshot ────────────────────────────────────────────────

export interface ClipboardSnapshot {
  text: string;
  html: string;
  /** PNG buffer (dataURL ou bytes). Vazio quando não havia imagem. */
  imagePngBase64: string;
  /** true se o clipboard estava completamente vazio (text/html/image todos vazios). */
  empty: boolean;
}

// ─── Method policy ─────────────────────────────────────────────────────

export interface MethodPolicySettings {
  /** Default global ('clipboard' v0.1). */
  injection_method_default?: InjectionMethod;
  /** Overrides per-exe — `{ 'keepass.exe': 'typing' }`. */
  injection_method_overrides?: Record<string, InjectionMethod>;
  /** Apps onde NÃO injeta — throw InjectionBlockedByPolicy. */
  injection_blacklist?: string[];
}

// ─── Errors ────────────────────────────────────────────────────────────

/** Policy bloqueou paste por blacklist do exeName atual. */
export class InjectionBlockedByPolicy extends Error {
  readonly code = 'INJECTION_BLOCKED_BY_POLICY' as const;
  constructor(public readonly exeName: string) {
    super(`Injection bloqueada por policy para ${exeName}`);
  }
}

/** Janela alvo perdeu foco e refocus falhou. */
export class WindowRefocusFailed extends Error {
  readonly code = 'WINDOW_REFOCUS_FAILED' as const;
}

/** Erro genérico do native binding (nut.js / fallback). */
export class KeystrokeSendError extends Error {
  readonly code = 'KEYSTROKE_SEND_ERROR' as const;
}

/** PowerShell timeout/erro na detecção de janela. */
export class ActiveWindowDetectError extends Error {
  readonly code = 'ACTIVE_WINDOW_DETECT_ERROR' as const;
}

// ─── Telemetry / DB extras ─────────────────────────────────────────────

/**
 * Resumo do paste para gravação em `transcription_repo.insert`:
 * paste_method, paste_succeeded, target_window_lost_focus, app_exe, app_window_title.
 * SttGateway usa pra integrar e2 ↔ e3 ↔ e6.
 */
export interface PasteOutcomeForRecord {
  paste_method: InjectionMethod | 'noop';
  paste_succeeded: boolean;
  target_window_lost_focus: boolean;
  app_exe: string | null;
  app_window_title: string | null;
}

export function pasteResultToOutcome(result: PasteResult): PasteOutcomeForRecord {
  // target_window_lost_focus = teve janela alvo MAS precisou re-focar pra reverter perda.
  // Heurística: refocused=true em pipeline normal = ALGO mudou foco depois do snapshot.
  return {
    paste_method: result.method,
    paste_succeeded: result.success,
    target_window_lost_focus: result.refocused === true,
    app_exe: result.targetWindow?.exeName ?? null,
    app_window_title: result.targetWindow?.windowTitle ?? null,
  };
}
