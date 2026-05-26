/**
 * Teste de integração end-to-end: SttGateway → TextInjector → TranscriptionRepo.
 *
 * Cobre WO-3 fechando o loop com WO-2 + WO-6:
 *  - SttGateway recebe áudio, retorna CascadeResult (groq sucesso mockado).
 *  - Hook onTranscribed chama textInjector.paste(result.text).
 *  - Após paste, insere row em transcription_repo com metadata:
 *    paste_method, paste_succeeded, target_window_lost_focus, app_exe,
 *    app_window_title, provider_used, latency_ms, etc.
 *
 * Cenários:
 *  1. Happy path (clipboard): paste OK → transcription gravada com paste_method='clipboard'.
 *  2. Policy blacklist: paste blocked=true → transcription gravada com paste_succeeded=false.
 *  3. Override per-app: keepass → paste_method='typing'.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FasterWhisperLocalProvider,
} from '../../src/main/stt/faster-whisper-local-provider.js';
import { GroqKeyPool } from '../../src/main/stt/groq-key-pool.js';
import { GroqProvider } from '../../src/main/stt/groq-provider.js';
import { SttGateway } from '../../src/main/stt/stt-gateway.js';
import { TextInjector } from '../../src/main/injection/text-injector.js';
import {
  pasteResultToOutcome,
  type WindowDetector,
  type WindowInfo,
} from '../../src/main/injection/injection-types.js';
import type {
  ClipboardLike,
  NativeImageFactory,
} from '../../src/main/injection/clipboard-state.js';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';

function audioBuf(): ArrayBuffer {
  return new Uint8Array([1, 2, 3]).buffer;
}

function makeDetector(window: WindowInfo | null): WindowDetector {
  return { getActiveWindow: vi.fn().mockResolvedValue(window) };
}

function makeClipboard(): ClipboardLike & { writes: { kind: string; value?: unknown }[] } {
  let text = 'ORIG';
  const writes: { kind: string; value?: unknown }[] = [];
  return {
    writes,
    readText: () => text,
    readHTML: () => '',
    readImage: () => ({ isEmpty: () => true, toDataURL: () => '' }),
    writeText: (v) => {
      text = v;
      writes.push({ kind: 'text', value: v });
    },
    writeHTML: (v) => writes.push({ kind: 'html', value: v }),
    writeImage: (v) => writes.push({ kind: 'image', value: v }),
    clear: () => {
      text = '';
      writes.push({ kind: 'clear' });
    },
  };
}

const fakeNativeImage: NativeImageFactory = {
  createFromDataURL: (s) => ({ __img: s }),
};

function seed1Online(ctx: TestDbContext): void {
  ctx.groqSlotMetaRepo.upsert(0, {
    api_key_encrypted: 'gsk_AAAA',
    label: 'a',
    validation_status: 'online',
  });
}

describe('Integration: SttGateway → TextInjector → TranscriptionRepo', () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
    seed1Online(ctx);
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it('happy path: groq success → clipboard paste → row inserida com metadata correta', async () => {
    // 1) Mock fetch Groq pra 200.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'ola mundo isso e um teste' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // 2) Monta injector com clipboard + detector mockados.
    const target: WindowInfo = {
      hwnd: 42,
      exeName: 'notepad.exe',
      windowTitle: 'Bloco de Notas',
      processId: 100,
    };
    const detector = makeDetector(target);
    const cb = makeClipboard();
    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn: async () => {},
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    // 3) Monta SttGateway com hook onTranscribed que chama injector + insert repo.
    const pool = new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
    const groqProvider = new GroqProvider(pool, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    const localProvider = new FasterWhisperLocalProvider({ scriptPath: '/nope' });
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo, {
      onTranscribed: async (result, { t0, now }) => {
        const paste = await injector.paste(result.text);
        const outcome = pasteResultToOutcome(paste);
        ctx.transcriptionRepo.insert({
          text: result.text,
          provider_used: result.provider,
          slot_index: result.slotIndex ?? null,
          slot_label: result.slotLabel ?? null,
          latency_ms: now - t0,
          language: result.language ?? null,
          paste_method: outcome.paste_method as 'clipboard' | 'typing',
          paste_succeeded: outcome.paste_succeeded,
          target_window_lost_focus: outcome.target_window_lost_focus,
          app_exe: outcome.app_exe,
          app_window_title: outcome.app_window_title,
        });
      },
    });

    const result = await gateway.transcribe(audioBuf());
    expect(result.provider).toBe('groq');

    // Asserts integração: clipboard recebeu texto processado.
    const textWrites = cb.writes.filter((w) => w.kind === 'text');
    expect(textWrites[0].value).toBe('Ola mundo isso e um teste.');

    // Assert: row foi inserida com metadata correta.
    const rows = ctx.transcriptionRepo.listRecent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider_used).toBe('groq');
    expect(rows[0].paste_method).toBe('clipboard');
    expect(rows[0].paste_succeeded).toBe(true);
    expect(rows[0].app_exe).toBe('notepad.exe');
    expect(rows[0].app_window_title).toBe('Bloco de Notas');
  });

  it('blacklist: secret_app bloqueia → paste_succeeded=false na row', async () => {
    ctx.settingsRepo.set('injection_blacklist', ['secret_app.exe']);

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'algum texto secreto' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const target: WindowInfo = {
      hwnd: 1,
      exeName: 'secret_app.exe',
      windowTitle: '',
      processId: 1,
    };
    const detector = makeDetector(target);
    const cb = makeClipboard();
    const sendPasteFn = vi.fn();
    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn,
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    const pool = new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
    const groqProvider = new GroqProvider(pool, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    const localProvider = new FasterWhisperLocalProvider({ scriptPath: '/nope' });
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo, {
      onTranscribed: async (result) => {
        const paste = await injector.paste(result.text);
        const outcome = pasteResultToOutcome(paste);
        ctx.transcriptionRepo.insert({
          text: result.text,
          provider_used: result.provider,
          slot_index: result.slotIndex ?? null,
          paste_method:
            outcome.paste_method === 'noop' ? 'clipboard' : outcome.paste_method,
          paste_succeeded: outcome.paste_succeeded,
          target_window_lost_focus: outcome.target_window_lost_focus,
          app_exe: outcome.app_exe,
          app_window_title: outcome.app_window_title,
        });
      },
    });

    await gateway.transcribe(audioBuf());
    expect(sendPasteFn).not.toHaveBeenCalled();

    const rows = ctx.transcriptionRepo.listRecent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0].paste_succeeded).toBe(false);
    expect(rows[0].app_exe).toBe('secret_app.exe');
  });

  it('override per-app: keepass.exe → paste_method=typing na row', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'senha forte aqui agora' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const target: WindowInfo = {
      hwnd: 1,
      exeName: 'keepass.exe',
      windowTitle: 'KeePass',
      processId: 1,
    };
    const detector = makeDetector(target);
    const cb = makeClipboard();
    const sendPasteFn = vi.fn();
    const typeTextFn = vi.fn(async () => {});
    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn,
      typeTextFn,
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    const pool = new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
    const groqProvider = new GroqProvider(pool, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    const localProvider = new FasterWhisperLocalProvider({ scriptPath: '/nope' });
    const gateway = new SttGateway(groqProvider, localProvider, pool, ctx.settingsRepo, {
      onTranscribed: async (result) => {
        const paste = await injector.paste(result.text);
        const outcome = pasteResultToOutcome(paste);
        ctx.transcriptionRepo.insert({
          text: result.text,
          provider_used: result.provider,
          slot_index: result.slotIndex ?? null,
          paste_method:
            outcome.paste_method === 'noop' ? 'clipboard' : outcome.paste_method,
          paste_succeeded: outcome.paste_succeeded,
          target_window_lost_focus: outcome.target_window_lost_focus,
          app_exe: outcome.app_exe,
          app_window_title: outcome.app_window_title,
        });
      },
    });

    await gateway.transcribe(audioBuf());
    expect(typeTextFn).toHaveBeenCalledOnce();
    expect(sendPasteFn).not.toHaveBeenCalled();

    const rows = ctx.transcriptionRepo.listRecent(10);
    expect(rows[0].paste_method).toBe('typing');
    expect(rows[0].paste_succeeded).toBe(true);
    expect(rows[0].app_exe).toBe('keepass.exe');
  });
});
