/**
 * Tipos compartilhados da camada STT.
 *
 * Espelha `internal-contracts.md` §2.1, §2.2, §2.3, §2.4 e re-exporta os erros
 * tipados de `@shared/errors`. Mantemos os tipos próximos do código consumidor
 * (main process) — o renderer só precisa de uma subset (PoolSnapshot,
 * ValidateKeyResult) que continua acessível via `@shared/ipc-types`.
 */

import type { GroqValidationStatus } from '../../shared/db-types.js';

export type SttProviderName = 'groq' | 'local';

// ─── SttProvider ───────────────────────────────────────────────────────

export interface TranscribeOptions {
  /** 'pt-BR' | 'en-US' | ... | undefined → auto-detect. */
  language?: string;
  /** Default 'audio/webm;codecs=opus' (MediaRecorder padrão). */
  mimeType?: string;
  /**
   * Quando true, pula o `onTranscribed` hook (paste + history insert + badge).
   * Usado pelo `stt:test-transcribe` — teste de mic mostra resultado inline
   * sem precisar colar nada nem poluir histórico.
   */
  skipPostHook?: boolean;
}

export interface TranscribeResult {
  text: string;
  latencyMs: number;
  provider: SttProviderName;
  slotIndex?: number;
  slotLabel?: string;
  language?: string;
  durationMs?: number;
}

export interface SttProvider {
  readonly name: SttProviderName;
  transcribe(audio: ArrayBuffer, opts?: TranscribeOptions): Promise<TranscribeResult>;
  isAvailable(): Promise<boolean>;
}

// ─── GroqKeyPool ───────────────────────────────────────────────────────

export type GroqSlotStatus = 'online' | 'invalid' | 'exhausted';

export interface SlotSnapshot {
  slotIndex: 0 | 1 | 2;
  hasKey: boolean;
  label?: string;
  status: GroqSlotStatus;
  validationStatus: GroqValidationStatus;
  usedToday: number;
  dailyCap: number;
  pctUsed: number;
  lastValidatedAt?: string;
  markedExhaustedAt?: string;
  markedInvalidAt?: string;
}

export interface PoolSnapshot {
  totalSlots: 3;
  online: number;
  invalid: number;
  exhausted: number;
  totalUsedToday: number;
  slots: SlotSnapshot[];
}

export interface NextSlot {
  apiKey: string;
  slotIndex: 0 | 1 | 2;
  label?: string;
}

// ─── ValidateKeyResult ────────────────────────────────────────────────

export interface ValidateKeyResult {
  valid: boolean;
  error?: string;
  latencyMs: number;
  /** true se 200 OK mas body sinaliza esgotamento — raro no Groq. */
  shouldMarkExhausted?: boolean;
}

// ─── CascadeResult ────────────────────────────────────────────────────

export interface CascadeAttempt {
  slotIndex?: number;
  slotLabel?: string;
  provider: SttProviderName;
  errorCode?: string;
  errorMessage?: string;
  latencyMs: number;
  status: 'ok' | 'error';
}

export interface CascadeResult extends TranscribeResult {
  fellBack: boolean;
  attempts: CascadeAttempt[];
  keyRotationCount: number;
}

// ─── Overlay badge payload ────────────────────────────────────────────

export interface OverlayBadgeEvent {
  kind: SttProviderName;
  slotIndex?: number;
  slotLabel?: string;
  latencyMs: number;
  ttlMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Mascara key Groq pra log/UI: `gsk_***ab12`. */
export function maskGroqKey(apiKey: string): string {
  if (!apiKey) return '';
  const tail = apiKey.slice(-4);
  return `gsk_***${tail}`;
}

// Re-export erros tipados consumidos por chamadores STT.
export {
  GroqAuthError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqOfflineError,
  PoolEmptyError,
  LocalSttSpawnError,
} from '../../shared/errors.js';

/**
 * Erros adicionais específicos da cascade que NÃO existem em `@shared/errors`
 * (cobertura cross-module ali é mais estável; estes são internos da camada STT).
 */
export class GroqUnknownError extends Error {
  readonly code = 'GROQ_UNKNOWN' as const;
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export class GroqAllSlotsUnavailable extends Error {
  readonly code = 'GROQ_ALL_SLOTS_UNAVAILABLE' as const;
}

export class LocalUnavailableError extends Error {
  readonly code = 'LOCAL_UNAVAILABLE' as const;
}

export class SttCompleteFailureError extends Error {
  readonly code = 'STT_COMPLETE_FAILURE' as const;
  constructor(message: string, public readonly attempts: CascadeAttempt[]) {
    super(message);
  }
}
