/**
 * validateGroqKey — checa health da key Groq via GET /v1/models (e2-groq-key-validation).
 *
 * Decisões:
 *   - GET /v1/models é cheap e auth-only (sem custo de transcrição).
 *   - 200 + lista contém 'whisper-large-v3-turbo' → valid.
 *   - 401 → invalid (key inexistente ou revogada).
 *   - 429 → valid mas sem cota agora (`shouldMarkExhausted=true`).
 *   - timeout (3s default) ou network error → invalid com mensagem amigável PT-BR.
 *
 * Sem dependência de SDK proprietário (ADR-01 / anti-pattern de WO-2).
 */

import { logger } from '../utils/logger.js';
import { maskGroqKey, type ValidateKeyResult } from './stt-types.js';

const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const DEFAULT_TIMEOUT_MS = 3_000;
const TARGET_MODEL = 'whisper-large-v3-turbo';

export interface ValidateGroqKeyOptions {
  /** Override do fetch global (testes). */
  fetch?: typeof fetch;
  /** Override do timeout. Default 3s. */
  timeoutMs?: number;
  /** Override pra fixar latência em testes (sem afetar implementação). */
  now?: () => number;
}

export async function validateGroqKey(
  apiKey: string,
  opts: ValidateGroqKeyOptions = {},
): Promise<ValidateKeyResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = opts.now ?? (() => Date.now());

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return { valid: false, error: 'Key vazia', latencyMs: 0 };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = now();

  try {
    const res = await fetchImpl(GROQ_MODELS_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    const latencyMs = now() - t0;

    if (res.status === 401) {
      logger.info({
        event: 'groq.validate.unauthorized',
        key_masked: maskGroqKey(apiKey),
        latency_ms: latencyMs,
      });
      return {
        valid: false,
        error: 'Key inválida ou expirada',
        latencyMs,
      };
    }

    if (res.status === 429) {
      logger.info({
        event: 'groq.validate.rate_limited',
        key_masked: maskGroqKey(apiKey),
        latency_ms: latencyMs,
      });
      return {
        valid: true,
        shouldMarkExhausted: true,
        latencyMs,
      };
    }

    if (!res.ok) {
      return {
        valid: false,
        error: `Erro ${res.status} da Groq`,
        latencyMs,
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        valid: false,
        error: 'Resposta inválida da Groq (JSON)',
        latencyMs,
      };
    }

    const hasTarget = bodyContainsTargetModel(body);
    if (!hasTarget) {
      // Modelo Whisper sumiu — key OK mas catálogo não tem o modelo esperado.
      // Mesmo assim consideramos válido (modelo pode aparecer com outro slug).
      logger.warn({
        event: 'groq.validate.target_model_missing',
        target: TARGET_MODEL,
        latency_ms: latencyMs,
      });
    }

    logger.info({
      event: 'groq.validate.ok',
      key_masked: maskGroqKey(apiKey),
      latency_ms: latencyMs,
      has_target_model: hasTarget,
    });
    return { valid: true, latencyMs };
  } catch (err) {
    const latencyMs = now() - t0;
    if ((err as { name?: string }).name === 'AbortError') {
      logger.warn({
        event: 'groq.validate.timeout',
        key_masked: maskGroqKey(apiKey),
        latency_ms: latencyMs,
      });
      return {
        valid: false,
        error: 'Timeout — verifique conexão',
        latencyMs,
      };
    }
    logger.warn({
      event: 'groq.validate.network_error',
      key_masked: maskGroqKey(apiKey),
      latency_ms: latencyMs,
      error: (err as Error).message,
    });
    return {
      valid: false,
      error: 'Sem conexão com api.groq.com',
      latencyMs,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function bodyContainsTargetModel(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  // Shape padrão Groq: { object: 'list', data: [{ id: 'whisper-large-v3-turbo', ... }] }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return false;
  return data.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const id = (entry as { id?: unknown }).id;
    return typeof id === 'string' && id === TARGET_MODEL;
  });
}
