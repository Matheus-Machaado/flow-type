/**
 * Testes do GroqProvider (e2-groq-provider).
 *
 * Cobre: 200/401/429/timeout/network + rotação de slot dentro do mesmo turno
 * (cascade superior orquestra; aqui valida que cada call individual marca
 * o slot corretamente).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroqKeyPool } from '../../src/main/stt/groq-key-pool.js';
import { GroqProvider } from '../../src/main/stt/groq-provider.js';
import {
  GroqAuthError,
  GroqOfflineError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqUnknownError,
} from '../../src/main/stt/stt-types.js';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';

function audioBuf(): ArrayBuffer {
  return new Uint8Array([1, 2, 3, 4, 5]).buffer;
}

describe('GroqProvider', () => {
  let ctx: TestDbContext;
  let pool: GroqKeyPool;

  function seed3Online(): void {
    ctx.groqSlotMetaRepo.upsert(0, {
      api_key_encrypted: 'gsk_AAAA',
      label: 'a',
      validation_status: 'online',
    });
    ctx.groqSlotMetaRepo.upsert(1, {
      api_key_encrypted: 'gsk_BBBB',
      label: 'b',
      validation_status: 'online',
    });
    ctx.groqSlotMetaRepo.upsert(2, {
      api_key_encrypted: 'gsk_CCCC',
      label: 'c',
      validation_status: 'online',
    });
  }

  beforeEach(() => {
    ctx = createTestDb();
    seed3Online();
    pool = new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('200 → returns text + latency + slot info, increments usage', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'olá mundo', language: 'pt', duration: 1.5 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const provider = new GroqProvider(pool, { fetch: fetchMock });
    const result = await provider.transcribe(audioBuf(), { language: 'pt-BR' });

    expect(result.text).toBe('olá mundo');
    expect(result.provider).toBe('groq');
    expect(result.slotIndex).toBe(0);
    expect(result.slotLabel).toBe('a');
    expect(result.language).toBe('pt');
    expect(result.durationMs).toBe(1500);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const snap = pool.snapshot();
    expect(snap.slots[0].usedToday).toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((init as RequestInit).method).toBe('POST');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer gsk_AAAA',
    );
  });

  it('401 → throws GroqAuthError + markInvalid + slotIndex anexado ao erro', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('Unauthorized', { status: 401 }),
    );
    const provider = new GroqProvider(pool, { fetch: fetchMock });

    await expect(provider.transcribe(audioBuf())).rejects.toBeInstanceOf(GroqAuthError);

    const snap = pool.snapshot();
    expect(snap.slots[0].status).toBe('invalid');
    expect(snap.slots[0].validationStatus).toBe('invalid');
  });

  it('429 → throws GroqRateLimitError + markExhausted', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('rate limit', { status: 429 }),
    );
    const provider = new GroqProvider(pool, { fetch: fetchMock });

    await expect(provider.transcribe(audioBuf())).rejects.toBeInstanceOf(GroqRateLimitError);

    const snap = pool.snapshot();
    expect(snap.slots[0].status).toBe('exhausted');
  });

  it('timeout (AbortError) → throws GroqTimeoutError without marking slot', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: { signal?: AbortSignal }) => {
      return new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          rej(err);
        });
      });
    });
    const provider = new GroqProvider(pool, {
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 20,
    });
    await expect(provider.transcribe(audioBuf())).rejects.toBeInstanceOf(GroqTimeoutError);
    const snap = pool.snapshot();
    expect(snap.slots[0].status).toBe('online'); // NÃO marca slot
    expect(snap.slots[0].usedToday).toBe(0);
  });

  it('network error → throws GroqOfflineError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ENOTFOUND api.groq.com');
    });
    const provider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    await expect(provider.transcribe(audioBuf())).rejects.toBeInstanceOf(GroqOfflineError);
  });

  it('500 → throws GroqUnknownError with status', async () => {
    const fetchMock = vi.fn(async () => new Response('err', { status: 500 }));
    const provider = new GroqProvider(pool, { fetch: fetchMock });
    try {
      await provider.transcribe(audioBuf());
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GroqUnknownError);
      expect((err as GroqUnknownError).status).toBe(500);
    }
  });

  it('rotation in same turn: 3 sequential calls hit slots 0,1,2', async () => {
    const callsByAuth: string[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      callsByAuth.push(auth);
      return new Response(JSON.stringify({ text: 'x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const provider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const r1 = await provider.transcribe(audioBuf());
    const r2 = await provider.transcribe(audioBuf());
    const r3 = await provider.transcribe(audioBuf());

    expect([r1.slotIndex, r2.slotIndex, r3.slotIndex]).toEqual([0, 1, 2]);
    expect(callsByAuth).toEqual([
      'Bearer gsk_AAAA',
      'Bearer gsk_BBBB',
      'Bearer gsk_CCCC',
    ]);
  });

  it('language pt-BR is shortened to "pt" in form data', async () => {
    let receivedForm: FormData | null = null;
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      receivedForm = init.body as FormData;
      return new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const provider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    await provider.transcribe(audioBuf(), { language: 'pt-BR' });
    expect(receivedForm).not.toBeNull();
    expect(receivedForm!.get('language')).toBe('pt');
    expect(receivedForm!.get('model')).toBe('whisper-large-v3-turbo');
    expect(receivedForm!.get('response_format')).toBe('json');
  });
});
