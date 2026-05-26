/**
 * Teste de integração end-to-end do SttGateway (e2-stt-telemetry-timing).
 *
 * Cobre:
 *  - distribuição uniforme: 60 transcribes com fetch sempre 200 → cada slot 20±1.
 *  - telemetria: keyRotationCount=0 quando sem rotação.
 *  - persistência: token_usage reflete os 60 incrementos com soma correta.
 *  - cascade graceful quando pool esvazia durante turno.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FasterWhisperLocalProvider } from '../../src/main/stt/faster-whisper-local-provider.js';
import { GroqKeyPool } from '../../src/main/stt/groq-key-pool.js';
import { GroqProvider } from '../../src/main/stt/groq-provider.js';
import { SttGateway } from '../../src/main/stt/stt-gateway.js';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';

function audioBuf(): ArrayBuffer {
  return new Uint8Array([42]).buffer;
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

describe('SttGateway integration — pool de 3 slots reais', () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
    seed3Online(ctx);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('60 transcribes consecutivos (sempre 200) → distribuição uniforme 20±1 por slot, soma=60', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      calls.push(auth);
      return new Response(JSON.stringify({ text: 'hi' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const pool = new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const localProvider = new FasterWhisperLocalProvider({ scriptPath: '/nope' });
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo);

    for (let i = 0; i < 60; i++) {
      const r = await gateway.transcribe(audioBuf());
      expect(r.provider).toBe('groq');
      expect(r.fellBack).toBe(false);
      expect(r.keyRotationCount).toBe(0);
    }

    const counts = {
      'Bearer gsk_AAAA': calls.filter((c) => c === 'Bearer gsk_AAAA').length,
      'Bearer gsk_BBBB': calls.filter((c) => c === 'Bearer gsk_BBBB').length,
      'Bearer gsk_CCCC': calls.filter((c) => c === 'Bearer gsk_CCCC').length,
    };
    for (const c of Object.values(counts)) {
      expect(c).toBeGreaterThanOrEqual(19);
      expect(c).toBeLessThanOrEqual(21);
    }

    // Soma persistida
    const snap = pool.snapshot();
    expect(snap.totalUsedToday).toBe(60);
    for (const s of snap.slots) {
      expect(s.usedToday).toBeGreaterThanOrEqual(19);
      expect(s.usedToday).toBeLessThanOrEqual(21);
      expect(s.status).toBe('online');
    }
  });

  it('telemetria: cascade com rotação grava attempts ordenados + keyRotationCount correto', async () => {
    let callIdx = 0;
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      callIdx++;
      const auth = (init.headers as Record<string, string>).Authorization;
      // primeira call slot 0: 429; segunda slot 1: 200
      if (auth === 'Bearer gsk_AAAA') {
        return new Response('rl', { status: 429 });
      }
      return new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const pool = new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const localProvider = new FasterWhisperLocalProvider({ scriptPath: '/nope' });
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo);

    const r = await gateway.transcribe(audioBuf());
    expect(r.provider).toBe('groq');
    expect(r.slotIndex).toBe(1);
    expect(r.keyRotationCount).toBe(1);
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0].status).toBe('error');
    expect(r.attempts[1].status).toBe('ok');
    expect(callIdx).toBe(2);

    // Slot 0 ficou exhausted; slot 1 contou 1 uso; slot 2 intocado.
    const snap = pool.snapshot();
    expect(snap.slots[0].status).toBe('exhausted');
    expect(snap.slots[1].usedToday).toBe(1);
    expect(snap.slots[2].usedToday).toBe(0);
  });

  it('pool esvazia durante turno (todos 429) + local stub OK → fellBack=true, attempts cobrem todos', async () => {
    const fetchMock = vi.fn(async () => new Response('rl', { status: 429 }));

    const pool = new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const localOk = {
      name: 'local' as const,
      transcribe: vi.fn(async () => ({
        text: 'local-fallback',
        latencyMs: 2200,
        provider: 'local' as const,
      })),
      isAvailable: vi.fn(async () => true),
    };
    const gateway = new SttGateway(
      groqProvider,
      localOk as unknown as FasterWhisperLocalProvider,
      pool,
      ctx.settingsRepo,
    );

    const r = await gateway.transcribe(audioBuf());
    expect(r.provider).toBe('local');
    expect(r.fellBack).toBe(true);
    expect(r.text).toBe('local-fallback');
    const groqAttempts = r.attempts.filter((a) => a.provider === 'groq');
    expect(groqAttempts).toHaveLength(3);
    expect(groqAttempts.every((a) => a.errorCode === 'GROQ_RATE_LIMIT')).toBe(true);
    expect(pool.allUnavailable()).toBe(true);
  });

  it('resetDaily recoloca slots em rotação após cap', async () => {
    // Cap baixo pra forçar exhaustion rápida.
    ctx.groqSlotMetaRepo.upsert(0, { daily_cap: 2 });
    ctx.groqSlotMetaRepo.upsert(1, { daily_cap: 2 });
    ctx.groqSlotMetaRepo.upsert(2, { daily_cap: 2 });

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const pool = new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
    const groqProvider = new GroqProvider(pool, { fetch: fetchMock as unknown as typeof fetch });
    const localProvider = new FasterWhisperLocalProvider({ scriptPath: '/nope' });
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo);

    // 6 sucessos = 2 por slot, depois todos auto-exhausted.
    for (let i = 0; i < 6; i++) {
      await gateway.transcribe(audioBuf());
    }
    expect(pool.allUnavailable()).toBe(true);

    pool.resetDaily();
    expect(pool.onlineCount()).toBe(3);
  });
});
