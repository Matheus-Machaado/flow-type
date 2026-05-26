/**
 * GroqProvider — implementa SttProvider via Groq Whisper Large v3 Turbo (e2-groq-provider).
 *
 * - Pool-aware: chama `pool.next()` antes de cada request (round-robin / skip invalid/exhausted).
 * - POST multipart `https://api.groq.com/openai/v1/audio/transcriptions`.
 * - Timeout via AbortController (5s default).
 * - Mapeamento de erros:
 *     200 → incrementUsage(slot) + return TranscribeResult
 *     401 → markInvalid(slot) → throw GroqAuthError
 *     429 → markExhausted(slot) → throw GroqRateLimitError
 *     timeout / network → throw GroqTimeoutError (NÃO marca slot)
 *     outros 4xx/5xx → throw GroqUnknownError(status)
 *
 * Não usa SDK proprietário (ADR-01).
 */

import { logger } from '../utils/logger.js';
import type { GroqKeyPool } from './groq-key-pool.js';
import {
  GroqAuthError,
  GroqOfflineError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqUnknownError,
  maskGroqKey,
  type SttProvider,
  type TranscribeOptions,
  type TranscribeResult,
} from './stt-types.js';

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MIME = 'audio/webm';

export interface GroqProviderOptions {
  fetch?: typeof fetch;
  /** Default 5000ms. */
  timeoutMs?: number;
  /** Override pra fixar latência em testes. */
  now?: () => number;
  /** Override do modelo. Default whisper-large-v3-turbo. */
  model?: string;
}

export class GroqProvider implements SttProvider {
  readonly name = 'groq' as const;

  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly model: string;

  constructor(private readonly pool: GroqKeyPool, opts: GroqProviderOptions = {}) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = opts.now ?? (() => Date.now());
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  async isAvailable(): Promise<boolean> {
    return !this.pool.allUnavailable();
  }

  /**
   * Faz UMA tentativa contra o próximo slot do pool. A cascade superior
   * (SttGateway) decide se chama de novo ao receber GroqAuthError /
   * GroqRateLimitError pra rodar próximo slot.
   */
  async transcribe(
    audio: ArrayBuffer,
    opts: TranscribeOptions = {},
  ): Promise<TranscribeResult> {
    const slot = this.pool.next(); // throws PoolEmptyError se vazio

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    const t0 = this.now();

    try {
      const form = new FormData();
      const blob = new Blob([audio], { type: opts.mimeType ?? DEFAULT_MIME });
      form.append('file', blob, 'audio.webm');
      form.append('model', this.model);
      form.append('response_format', 'json');
      if (opts.language) {
        form.append('language', shortLanguageCode(opts.language));
      }

      const res = await this.fetchImpl(GROQ_TRANSCRIBE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${slot.apiKey}`,
        },
        body: form,
        signal: controller.signal,
      });

      const latencyMs = this.now() - t0;

      if (res.status === 401) {
        this.pool.markInvalid(slot.slotIndex);
        logger.warn({
          event: 'groq.transcribe.auth_error',
          slot: slot.slotIndex,
          key_masked: maskGroqKey(slot.apiKey),
          latency_ms: latencyMs,
        });
        throw withSlot(new GroqAuthError('Groq 401 — slot invalidado'), slot.slotIndex);
      }

      if (res.status === 429) {
        this.pool.markExhausted(slot.slotIndex);
        logger.warn({
          event: 'groq.transcribe.rate_limited',
          slot: slot.slotIndex,
          key_masked: maskGroqKey(slot.apiKey),
          latency_ms: latencyMs,
        });
        throw withSlot(new GroqRateLimitError('Groq 429 — slot esgotado'), slot.slotIndex);
      }

      if (!res.ok) {
        logger.warn({
          event: 'groq.transcribe.unknown_error',
          slot: slot.slotIndex,
          status: res.status,
          latency_ms: latencyMs,
        });
        throw withSlot(
          new GroqUnknownError(`Groq HTTP ${res.status}`, res.status),
          slot.slotIndex,
        );
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw withSlot(
          new GroqUnknownError('Groq response não-JSON', res.status),
          slot.slotIndex,
        );
      }

      const text = extractText(body);
      const language = extractLanguage(body) ?? opts.language;
      const durationMs = extractDurationMs(body);

      this.pool.incrementUsage(slot.slotIndex, 1);

      logger.info({
        event: 'groq.transcribe.ok',
        slot: slot.slotIndex,
        key_masked: maskGroqKey(slot.apiKey),
        latency_ms: latencyMs,
        text_chars: text.length,
        language,
      });

      return {
        text,
        latencyMs,
        provider: 'groq',
        slotIndex: slot.slotIndex,
        slotLabel: slot.label,
        language,
        durationMs,
      };
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        const latencyMs = this.now() - t0;
        logger.warn({
          event: 'groq.transcribe.timeout',
          slot: slot.slotIndex,
          latency_ms: latencyMs,
        });
        throw withSlot(new GroqTimeoutError('Groq timeout'), slot.slotIndex);
      }
      if (err instanceof GroqAuthError || err instanceof GroqRateLimitError ||
          err instanceof GroqUnknownError || err instanceof GroqTimeoutError) {
        throw err;
      }
      // Erro de rede genuíno (DNS, conn refused). NÃO marca slot.
      logger.warn({
        event: 'groq.transcribe.network_error',
        slot: slot.slotIndex,
        error: (err as Error).message,
      });
      throw withSlot(new GroqOfflineError('Groq offline / network error'), slot.slotIndex);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Anexa `slotIndex` ao erro pra que a cascade (camada acima) saiba qual slot
 * disparou — útil pra telemetria sem refazer pool.last().
 */
function withSlot<E extends Error>(err: E, slotIndex: number): E {
  (err as Error & { slotIndex?: number }).slotIndex = slotIndex;
  return err;
}

function shortLanguageCode(lang: string): string {
  // Groq aceita ISO 639-1 (pt, en). Converte 'pt-BR' → 'pt', 'en-US' → 'en'.
  return lang.toLowerCase().split('-')[0];
}

function extractText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const text = (body as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

function extractLanguage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const lang = (body as { language?: unknown }).language;
  return typeof lang === 'string' ? lang : undefined;
}

function extractDurationMs(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  // Groq retorna duration em segundos.
  const dur = (body as { duration?: unknown }).duration;
  if (typeof dur !== 'number' || !Number.isFinite(dur)) return undefined;
  return Math.round(dur * 1000);
}
