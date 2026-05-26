/**
 * Testes do validateGroqKey (e2-groq-key-validation). 4 cenários:
 * 200 / 401 / 429 / timeout + network.
 */

import { describe, expect, it, vi } from 'vitest';
import { validateGroqKey } from '../../src/main/stt/validate-groq-key.js';

describe('validateGroqKey', () => {
  it('200 + whisper model present → valid=true', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'whisper-large-v3-turbo' }, { id: 'llama-3' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const r = await validateGroqKey('gsk_real_key_AAAA', { fetch: fetchMock });
    expect(r.valid).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer gsk_real_key_AAAA',
    );
  });

  it('200 sem whisper-large-v3-turbo no body → ainda valid=true (warn-log)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ object: 'list', data: [{ id: 'llama-3' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await validateGroqKey('gsk_real_key_AAAA', { fetch: fetchMock });
    expect(r.valid).toBe(true);
  });

  it('401 → valid=false + error PT-BR', async () => {
    const fetchMock = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
    const r = await validateGroqKey('gsk_bad_key', { fetch: fetchMock });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('Key inválida ou expirada');
  });

  it('429 → valid=true + shouldMarkExhausted=true', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limit', { status: 429 }));
    const r = await validateGroqKey('gsk_ratelimited', { fetch: fetchMock });
    expect(r.valid).toBe(true);
    expect(r.shouldMarkExhausted).toBe(true);
  });

  it('timeout via AbortController → valid=false + error PT-BR "Timeout"', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: { signal?: AbortSignal }) => {
      return new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          rej(err);
        });
      });
    });
    const r = await validateGroqKey('gsk_slow', {
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 10,
    });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Timeout');
  });

  it('network error → valid=false + error "Sem conexão"', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ENOTFOUND api.groq.com');
    });
    const r = await validateGroqKey('gsk_no_net', { fetch: fetchMock as unknown as typeof fetch });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Sem conexão');
  });

  it('500 → valid=false + error genérica', async () => {
    const fetchMock = vi.fn(async () => new Response('err', { status: 500 }));
    const r = await validateGroqKey('gsk_5xx', { fetch: fetchMock });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('500');
  });

  it('empty key → valid=false sem fetch', async () => {
    const fetchMock = vi.fn();
    const r = await validateGroqKey('', { fetch: fetchMock as unknown as typeof fetch });
    expect(r.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
