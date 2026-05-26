/**
 * Testes do TextInjector — pipeline principal (e3-clipboard-paste-pipeline).
 *
 * Cobre:
 *   - clipboard pipeline: snapshot → write → refocus → paste → sleep → restore
 *   - typing pipeline: refocus → typeText
 *   - blacklist policy: blocked=true, success=false
 *   - override per-app (keepass) → typing
 *   - texto vazio → noop
 *   - paste falha → restore SEMPRE chamado (finally)
 *   - punctuation aplicado quando enabled
 *   - texto NÃO loggado integralmente
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextInjector } from '../../src/main/injection/text-injector.js';
import type {
  WindowDetector,
  WindowInfo,
} from '../../src/main/injection/injection-types.js';
import type {
  ClipboardLike,
  NativeImageFactory,
} from '../../src/main/injection/clipboard-state.js';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';

function makeDetector(window: WindowInfo | null): WindowDetector {
  return {
    getActiveWindow: vi.fn().mockResolvedValue(window),
  };
}

function makeClipboard(initial = { text: 'ORIGINAL' }): ClipboardLike & {
  writes: { kind: string; value?: unknown }[];
} {
  let text = initial.text;
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

describe('TextInjector — clipboard pipeline', () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('happy path: snapshot → write → refocus → paste → sleep → restore', async () => {
    const detector = makeDetector({
      hwnd: 42,
      exeName: 'notepad.exe',
      windowTitle: 'Bloco de Notas',
      processId: 100,
    });
    const cb = makeClipboard({ text: 'ORIGINAL' });
    const order: string[] = [];
    const sendPasteFn = vi.fn(async () => {
      order.push('paste');
    });
    const refocusFn = vi.fn(async (_target: WindowInfo | null) => {
      order.push('refocus');
      return true;
    });
    const sleepFn = vi.fn(async (_ms: number) => {
      order.push('sleep');
    });

    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn,
      refocusFn,
      sleepFn,
    });

    const result = await injector.paste('Texto novo');
    expect(result.success).toBe(true);
    expect(result.method).toBe('clipboard');
    expect(result.targetWindow?.exeName).toBe('notepad.exe');

    // Ordem: refocus → paste → sleep (write é síncrono antes; restore vem no finally)
    expect(order).toEqual(['refocus', 'paste', 'sleep']);

    // Clipboard escreveu o texto processado E restaurou original.
    const textWrites = cb.writes.filter((w) => w.kind === 'text');
    expect(textWrites[0].value).toBe('Texto novo'); // 2 palavras = sem ponto
    expect(textWrites.at(-1)?.value).toBe('ORIGINAL');
  });

  it('clipboard pipeline: restore SEMPRE chamado mesmo se sendPaste falha', async () => {
    const detector = makeDetector({
      hwnd: 1,
      exeName: 'notepad.exe',
      windowTitle: '',
      processId: 1,
    });
    const cb = makeClipboard({ text: 'ORIGINAL' });
    const sendPasteFn = vi.fn(async () => {
      throw new Error('paste exploded');
    });

    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn,
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    const result = await injector.paste('texto qualquer');
    expect(result.success).toBe(false);
    expect(result.errorReason).toContain('paste exploded');

    // Restore foi chamado mesmo com falha do paste.
    const textWrites = cb.writes.filter((w) => w.kind === 'text');
    expect(textWrites.at(-1)?.value).toBe('ORIGINAL');
  });

  it('blacklist: app bloqueado → success=false, blocked=true', async () => {
    ctx.settingsRepo.set('injection_blacklist', ['secret_app.exe']);

    const detector = makeDetector({
      hwnd: 1,
      exeName: 'secret_app.exe',
      windowTitle: '',
      processId: 1,
    });
    const cb = makeClipboard();
    const sendPasteFn = vi.fn();
    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn,
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    const result = await injector.paste('algo');
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.errorReason).toMatch(/bloqueado/i);
    expect(sendPasteFn).not.toHaveBeenCalled();
  });

  it('override per-app: keepass → typing branch', async () => {
    const detector = makeDetector({
      hwnd: 1,
      exeName: 'keepass.exe',
      windowTitle: '',
      processId: 1,
    });
    const cb = makeClipboard();
    const sendPasteFn = vi.fn();
    const typeTextFn = vi.fn(async (_text: string) => {});

    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn,
      typeTextFn,
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    const result = await injector.paste('senha forte aqui');
    expect(result.success).toBe(true);
    expect(result.method).toBe('typing');
    expect(typeTextFn).toHaveBeenCalledOnce();
    expect(sendPasteFn).not.toHaveBeenCalled();
  });

  it('texto vazio → method=noop, success=true, sem mexer no clipboard', async () => {
    const detector = makeDetector({
      hwnd: 1,
      exeName: 'notepad.exe',
      windowTitle: '',
      processId: 1,
    });
    const cb = makeClipboard();
    const sendPasteFn = vi.fn();

    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn,
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    const result = await injector.paste('   ');
    expect(result.method).toBe('noop');
    expect(result.success).toBe(true);
    expect(sendPasteFn).not.toHaveBeenCalled();
    // Clipboard intocado.
    expect(cb.writes).toEqual([]);
  });

  it('punctuation heuristic aplicada por default', async () => {
    const detector = makeDetector({
      hwnd: 1,
      exeName: 'notepad.exe',
      windowTitle: '',
      processId: 1,
    });
    const cb = makeClipboard({ text: 'ORIG' });
    const sendPasteFn = vi.fn();

    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn,
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    await injector.paste('ola mundo isso e um teste');
    const textWrites = cb.writes.filter((w) => w.kind === 'text');
    // 1º write = texto processado (capitalize + period).
    expect(textWrites[0].value).toBe('Ola mundo isso e um teste.');
  });

  it('smart_punctuation=false → texto cru (apenas trim)', async () => {
    ctx.settingsRepo.set('smart_punctuation', false);

    const detector = makeDetector({
      hwnd: 1,
      exeName: 'notepad.exe',
      windowTitle: '',
      processId: 1,
    });
    const cb = makeClipboard({ text: 'ORIG' });
    const sendPasteFn = vi.fn();

    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn,
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    await injector.paste('  ola mundo isso e teste  ');
    const textWrites = cb.writes.filter((w) => w.kind === 'text');
    expect(textWrites[0].value).toBe('ola mundo isso e teste');
  });

  it('typing branch: typeText falha → success=false sem perder mensagem', async () => {
    ctx.settingsRepo.set('injection_method_default', 'typing');

    const detector = makeDetector({
      hwnd: 1,
      exeName: 'notepad.exe',
      windowTitle: '',
      processId: 1,
    });
    const cb = makeClipboard();
    const typeTextFn = vi.fn(async () => {
      throw new Error('binding broke');
    });
    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn: async () => {},
      typeTextFn,
      refocusFn: async () => true,
      sleepFn: async () => {},
    });

    const result = await injector.paste('senha aqui');
    expect(result.success).toBe(false);
    expect(result.method).toBe('typing');
    expect(result.errorReason).toContain('binding broke');
  });

  it('latencyMs > 0 e targetWindow preservada', async () => {
    const target: WindowInfo = {
      hwnd: 42,
      exeName: 'chrome.exe',
      windowTitle: 'Tab',
      processId: 99,
    };
    const detector = makeDetector(target);
    const cb = makeClipboard();
    let t = 0;
    const injector = new TextInjector(detector, ctx.settingsRepo, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
      sendPasteFn: async () => {},
      refocusFn: async () => true,
      sleepFn: async () => {},
      now: () => {
        t += 5;
        return t;
      },
    });
    const result = await injector.paste('algum texto');
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.targetWindow).toEqual(target);
  });
});
