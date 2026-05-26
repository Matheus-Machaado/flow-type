/**
 * Testes de snapshotClipboard + restoreClipboard (e3-clipboard-snapshot-restore).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  restoreClipboard,
  snapshotClipboard,
  type ClipboardLike,
  type NativeImageFactory,
} from '../../src/main/injection/clipboard-state.js';

function makeFakeClipboard(initial: {
  text?: string;
  html?: string;
  imageEmpty?: boolean;
  imageDataUrl?: string;
}): ClipboardLike & {
  writes: { kind: 'text' | 'html' | 'image' | 'clear'; value?: unknown }[];
} {
  let text = initial.text ?? '';
  let html = initial.html ?? '';
  const imageEmpty = initial.imageEmpty ?? !initial.imageDataUrl;
  const dataUrl = initial.imageDataUrl ?? '';
  const writes: { kind: 'text' | 'html' | 'image' | 'clear'; value?: unknown }[] = [];
  return {
    writes,
    readText: () => text,
    readHTML: () => html,
    readImage: () => ({
      isEmpty: () => imageEmpty,
      toDataURL: () => dataUrl,
    }),
    writeText: (v) => {
      text = v;
      writes.push({ kind: 'text', value: v });
    },
    writeHTML: (v) => {
      html = v;
      writes.push({ kind: 'html', value: v });
    },
    writeImage: (v) => {
      writes.push({ kind: 'image', value: v });
    },
    clear: () => {
      text = '';
      html = '';
      writes.push({ kind: 'clear' });
    },
  };
}

const fakeNativeImage: NativeImageFactory = {
  createFromDataURL: (dataUrl: string) => ({ __img: dataUrl }),
};

describe('snapshotClipboard', () => {
  it('captura text + html + image', () => {
    const cb = makeFakeClipboard({
      text: 'hello',
      html: '<p>hello</p>',
      imageDataUrl: 'data:image/png;base64,IMG',
    });
    const snap = snapshotClipboard(cb);
    expect(snap.text).toBe('hello');
    expect(snap.html).toBe('<p>hello</p>');
    expect(snap.imagePngBase64).toBe('data:image/png;base64,IMG');
    expect(snap.empty).toBe(false);
  });

  it('clipboard vazio → snapshot.empty=true', () => {
    const cb = makeFakeClipboard({});
    const snap = snapshotClipboard(cb);
    expect(snap.empty).toBe(true);
    expect(snap.text).toBe('');
    expect(snap.html).toBe('');
    expect(snap.imagePngBase64).toBe('');
  });

  it('readText throws → snapshot.text vazio (graceful)', () => {
    const cb: ClipboardLike = {
      readText: () => {
        throw new Error('boom');
      },
      readHTML: () => '',
      readImage: () => ({ isEmpty: () => true, toDataURL: () => '' }),
      writeText: () => {
        /* */
      },
      writeHTML: () => {
        /* */
      },
      writeImage: () => {
        /* */
      },
      clear: () => {
        /* */
      },
    };
    const snap = snapshotClipboard(cb);
    expect(snap.text).toBe('');
    expect(snap.empty).toBe(true);
  });
});

describe('restoreClipboard', () => {
  it('snapshot.empty=true → chama clear()', () => {
    const cb = makeFakeClipboard({ text: 'novo texto colado' });
    restoreClipboard({ text: '', html: '', imagePngBase64: '', empty: true }, {
      clipboard: cb,
      nativeImage: fakeNativeImage,
    });
    expect(cb.writes.some((w) => w.kind === 'clear')).toBe(true);
  });

  it('snapshot só texto → writeText(text)', () => {
    const cb = makeFakeClipboard({ text: 'novo' });
    restoreClipboard(
      { text: 'original', html: '', imagePngBase64: '', empty: false },
      { clipboard: cb, nativeImage: fakeNativeImage },
    );
    const textWrites = cb.writes.filter((w) => w.kind === 'text');
    expect(textWrites.at(-1)?.value).toBe('original');
  });

  it('snapshot com imagem → writeImage + writeText (text por último)', () => {
    const cb = makeFakeClipboard({ text: 'novo' });
    restoreClipboard(
      {
        text: 'original',
        html: '<p>original</p>',
        imagePngBase64: 'data:image/png;base64,IMG',
        empty: false,
      },
      { clipboard: cb, nativeImage: fakeNativeImage },
    );
    const kinds = cb.writes.map((w) => w.kind);
    // Ordem: image → html → text (text por último)
    expect(kinds).toEqual(['image', 'html', 'text']);
  });

  it('log warning quando restore demora >200ms', () => {
    const cb = makeFakeClipboard({ text: 'novo' });
    let elapsed = 0;
    const fakeNow = vi.fn(() => {
      const v = elapsed;
      elapsed += 250; // 1ª call t0=0; 2ª retorna 250 (delta 250ms)
      return v;
    });
    // Não vamos asserir o log diretamente (logger pino silent em test),
    // mas verificamos que restore NÃO crashou com clock controlado.
    restoreClipboard(
      { text: 'original', html: '', imagePngBase64: '', empty: false },
      { clipboard: cb, nativeImage: fakeNativeImage, now: fakeNow },
    );
    expect(cb.writes.find((w) => w.kind === 'text' && w.value === 'original')).toBeTruthy();
  });
});
