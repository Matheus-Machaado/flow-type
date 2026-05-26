/**
 * Testes do SttGateway — cascade 2 níveis (e2-stt-cascade-fallback).
 *
 * Cobre:
 *  - 3 slots: #0 429 → #1 401 → #2 200 → provider_used=groq, key_rotation_count=2
 *  - stt_force_local=true → Groq nunca chamado
 *  - todos slots Groq fail + local fail → SttCompleteFailureError
 *  - todos slots Groq fail + local OK → fellBack=true
 *  - emite overlay badge no resultado final
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FasterWhisperLocalProvider } from '../../src/main/stt/faster-whisper-local-provider.js';
import { GroqKeyPool } from '../../src/main/stt/groq-key-pool.js';
import { GroqProvider } from '../../src/main/stt/groq-provider.js';
import { SttGateway } from '../../src/main/stt/stt-gateway.js';
import {
  LocalUnavailableError,
  SttCompleteFailureError,
} from '../../src/main/stt/stt-types.js';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';

function audioBuf(): ArrayBuffer {
  return new Uint8Array([1, 2, 3, 4, 5]).buffer;
}

function seed3Online(ctx: TestDbContext): void {
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

/**
 * Helper: fetch mock que retorna status por slot (auth header → response).
 * `responses` é Map<key, () => Response>. Se key não mapeada → 500.
 */
function buildFetchByKey(responses: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (_url: unknown, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).Authorization ?? '';
    const key = auth.replace(/^Bearer\s+/, '');
    const handler = responses[key];
    if (!handler) {
      return new Response('unknown key', { status: 500 });
    }
    return handler();
  });
}

describe('SttGateway — cascade 2 níveis', () => {
  let ctx: TestDbContext;
  let pool: GroqKeyPool;
  let localProvider: FasterWhisperLocalProvider;

  beforeEach(() => {
    ctx = createTestDb();
    seed3Online(ctx);
    pool = new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
    // Local provider sem script Python (sempre falha com LocalUnavailable)
    localProvider = new FasterWhisperLocalProvider({
      scriptPath: '/nonexistent/path/to/whisper-runner.py',
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('slot 0 → 429, slot 1 → 401, slot 2 → 200: provider=groq, key_rotation_count=2, attempts ordenados', async () => {
    const fetchMock = buildFetchByKey({
      gsk_AAAA: () => new Response('rate limit', { status: 429 }),
      gsk_BBBB: () => new Response('unauthorized', { status: 401 }),
      gsk_CCCC: () =>
        new Response(JSON.stringify({ text: 'olá', language: 'pt' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const broadcastBadge = vi.fn();
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo, {
      broadcastBadge,
    });

    const result = await gateway.transcribe(audioBuf());

    expect(result.provider).toBe('groq');
    expect(result.text).toBe('olá');
    expect(result.fellBack).toBe(false);
    expect(result.keyRotationCount).toBe(2);
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[0]).toMatchObject({
      slotIndex: 0,
      provider: 'groq',
      errorCode: 'GROQ_RATE_LIMIT',
      status: 'error',
    });
    expect(result.attempts[1]).toMatchObject({
      slotIndex: 1,
      provider: 'groq',
      errorCode: 'GROQ_AUTH',
      status: 'error',
    });
    expect(result.attempts[2]).toMatchObject({
      slotIndex: 2,
      provider: 'groq',
      status: 'ok',
    });

    // Pool: slot 0 exhausted, slot 1 invalid, slot 2 online (1 uso)
    const snap = pool.snapshot();
    expect(snap.slots[0].status).toBe('exhausted');
    expect(snap.slots[1].status).toBe('invalid');
    expect(snap.slots[2].status).toBe('online');
    expect(snap.slots[2].usedToday).toBe(1);

    // Badge emitido com info do slot vencedor
    expect(broadcastBadge).toHaveBeenCalledTimes(1);
    expect(broadcastBadge).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'groq', slotIndex: 2, slotLabel: 'c' }),
    );
  });

  it('stt_force_local=true → pula Groq inteiro, tenta local (e falha pq script missing)', async () => {
    ctx.settingsRepo.set('stt_force_local', true);
    const fetchMock = vi.fn();
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo);

    await expect(gateway.transcribe(audioBuf())).rejects.toBeInstanceOf(
      SttCompleteFailureError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('todos slots Groq 401 + local indisponível → SttCompleteFailureError com attempts', async () => {
    const fetchMock = buildFetchByKey({
      gsk_AAAA: () => new Response('u', { status: 401 }),
      gsk_BBBB: () => new Response('u', { status: 401 }),
      gsk_CCCC: () => new Response('u', { status: 401 }),
    });
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo);

    try {
      await gateway.transcribe(audioBuf());
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SttCompleteFailureError);
      const sttErr = err as SttCompleteFailureError;
      // 3 attempts Groq (401) + 1 attempt local (LocalUnavailable)
      expect(sttErr.attempts.length).toBeGreaterThanOrEqual(3);
      const groqErrs = sttErr.attempts.filter((a) => a.provider === 'groq');
      expect(groqErrs).toHaveLength(3);
      expect(groqErrs.every((a) => a.errorCode === 'GROQ_AUTH')).toBe(true);
      const localErr = sttErr.attempts.find((a) => a.provider === 'local');
      expect(localErr).toBeDefined();
      expect(localErr!.errorCode).toBe('LOCAL_UNAVAILABLE');
    }
  });

  it('todos slots Groq 429 + local OK (mocked provider) → fellBack=true, provider=local', async () => {
    const fetchMock = buildFetchByKey({
      gsk_AAAA: () => new Response('rl', { status: 429 }),
      gsk_BBBB: () => new Response('rl', { status: 429 }),
      gsk_CCCC: () => new Response('rl', { status: 429 }),
    });
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    // Substitui local por stub que retorna OK
    const localOk = {
      name: 'local' as const,
      transcribe: vi.fn(async () => ({
        text: 'local result',
        latencyMs: 2200,
        provider: 'local' as const,
        language: 'en',
      })),
      isAvailable: vi.fn(async () => true),
    };
    const gateway = new SttGateway(
      groqProvider,
      localOk as unknown as FasterWhisperLocalProvider,
      pool,
      ctx.settingsRepo,
    );

    const result = await gateway.transcribe(audioBuf());
    expect(result.provider).toBe('local');
    expect(result.fellBack).toBe(true);
    expect(result.text).toBe('local result');
    expect(result.attempts.filter((a) => a.provider === 'groq')).toHaveLength(3);
    expect(result.attempts[result.attempts.length - 1].provider).toBe('local');
    expect(result.attempts[result.attempts.length - 1].status).toBe('ok');

    // Pool: todos exhausted
    expect(pool.allUnavailable()).toBe(true);
  });

  it('emite overlay badge com info do provider vencedor', async () => {
    const fetchMock = buildFetchByKey({
      gsk_AAAA: () =>
        new Response(JSON.stringify({ text: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const broadcastBadge = vi.fn();
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo, {
      broadcastBadge,
      badgeTtlMs: 2000,
    });
    await gateway.transcribe(audioBuf());
    expect(broadcastBadge).toHaveBeenCalledTimes(1);
    expect(broadcastBadge.mock.calls[0]![0]).toMatchObject({
      kind: 'groq',
      slotIndex: 0,
      slotLabel: 'a',
      ttlMs: 2000,
    });
  });

  it('local stub throws explicitly → wraps em SttCompleteFailureError', async () => {
    ctx.settingsRepo.set('stt_force_local', true);
    const localFail = {
      name: 'local' as const,
      transcribe: vi.fn(async () => {
        throw new LocalUnavailableError('boom');
      }),
      isAvailable: vi.fn(async () => false),
    };
    const fetchMock = vi.fn();
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const gateway = new SttGateway(
      groqProvider,
      localFail as unknown as FasterWhisperLocalProvider,
      pool,
      ctx.settingsRepo,
    );
    await expect(gateway.transcribe(audioBuf())).rejects.toBeInstanceOf(
      SttCompleteFailureError,
    );
  });
});
