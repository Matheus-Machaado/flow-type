/**
 * Clipboard snapshot/restore helpers (e3-clipboard-snapshot-restore).
 *
 * - snapshotClipboard() captura text + html + image (PNG base64) atual.
 * - restoreClipboard(snapshot) restaura na ordem reversa (text por último
 *   pra ser o "default" — leitores ricos preferem text quando disponível).
 * - Edge case: snapshot vazio → restore = clipboard.clear().
 * - Logs warning se restore demora mais que RESTORE_SLOW_MS (default 200ms).
 *
 * Abstrai a API do `electron.clipboard` via interface `ClipboardLike` pra
 * permitir test injection sem precisar do `electron` real no vitest.
 */

import { logger } from '../utils/logger.js';
import type { ClipboardSnapshot } from './injection-types.js';

const RESTORE_SLOW_MS = 200;

/**
 * Subset da API `electron.clipboard` que precisamos. Permite tests sem electron real.
 */
export interface ClipboardLike {
  readText(): string;
  readHTML(): string;
  /** Retorna NativeImage. Usamos `.isEmpty()` + `.toDataURL()` (PNG inline). */
  readImage(): {
    isEmpty(): boolean;
    toDataURL(): string;
  };
  writeText(text: string): void;
  writeHTML(html: string): void;
  writeImage(image: unknown): void;
  clear(): void;
}

/**
 * Constructor de NativeImage a partir de data URL (PNG base64).
 * Em prod chamamos `nativeImage.createFromDataURL`. Em testes mockamos.
 */
export interface NativeImageFactory {
  createFromDataURL(dataUrl: string): unknown;
}

let defaultClipboard: ClipboardLike | null = null;
let defaultNativeImageFactory: NativeImageFactory | null = null;

/**
 * Carregamento preguiçoso do `electron.clipboard` real — evita carregar
 * o pacote `electron` (que requer process Electron) em testes Node-only.
 */
function getDefaultClipboard(): ClipboardLike {
  if (defaultClipboard) return defaultClipboard;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require('electron') as {
    clipboard: ClipboardLike;
    nativeImage: NativeImageFactory;
  };
  defaultClipboard = electron.clipboard;
  defaultNativeImageFactory = electron.nativeImage;
  return defaultClipboard;
}

function getDefaultImageFactory(): NativeImageFactory {
  if (defaultNativeImageFactory) return defaultNativeImageFactory;
  getDefaultClipboard();
  if (!defaultNativeImageFactory) throw new Error('NativeImage factory not loaded');
  return defaultNativeImageFactory;
}

/**
 * Captura snapshot do clipboard atual.
 *
 * `imagePngBase64` armazena dataURL no formato `data:image/png;base64,...`
 * (compatível com `nativeImage.createFromDataURL` no restore).
 */
export function snapshotClipboard(clipboard?: ClipboardLike): ClipboardSnapshot {
  const cb = clipboard ?? getDefaultClipboard();
  let text = '';
  let html = '';
  let imagePngBase64 = '';
  try {
    text = cb.readText() ?? '';
  } catch {
    text = '';
  }
  try {
    html = cb.readHTML() ?? '';
  } catch {
    html = '';
  }
  try {
    const img = cb.readImage();
    if (img && !img.isEmpty()) {
      imagePngBase64 = img.toDataURL();
    }
  } catch {
    imagePngBase64 = '';
  }
  return {
    text,
    html,
    imagePngBase64,
    empty: text.length === 0 && html.length === 0 && imagePngBase64.length === 0,
  };
}

/**
 * Restaura o snapshot. Ordem: image → html → text (text por último
 * pra ser o conteúdo "default" lido por consumers simples).
 *
 * Snapshot vazio → `clipboard.clear()`.
 *
 * Latência > 200ms emite warning estruturado (não falha).
 */
export function restoreClipboard(
  snapshot: ClipboardSnapshot,
  opts: {
    clipboard?: ClipboardLike;
    nativeImage?: NativeImageFactory;
    now?: () => number;
  } = {},
): void {
  const cb = opts.clipboard ?? getDefaultClipboard();
  const now = opts.now ?? Date.now;
  const t0 = now();

  if (snapshot.empty) {
    try {
      cb.clear();
    } catch (err) {
      logger.warn({
        event: 'injection.clipboard.clear_failed',
        error: (err as Error).message,
      });
    }
    finalize(t0, now);
    return;
  }

  if (snapshot.imagePngBase64) {
    try {
      const factory = opts.nativeImage ?? getDefaultImageFactory();
      const img = factory.createFromDataURL(snapshot.imagePngBase64);
      cb.writeImage(img);
    } catch (err) {
      logger.warn({
        event: 'injection.clipboard.restore_image_failed',
        error: (err as Error).message,
      });
    }
  }
  if (snapshot.html) {
    try {
      cb.writeHTML(snapshot.html);
    } catch (err) {
      logger.warn({
        event: 'injection.clipboard.restore_html_failed',
        error: (err as Error).message,
      });
    }
  }
  if (snapshot.text) {
    try {
      cb.writeText(snapshot.text);
    } catch (err) {
      logger.warn({
        event: 'injection.clipboard.restore_text_failed',
        error: (err as Error).message,
      });
    }
  }
  finalize(t0, now);
}

function finalize(t0: number, now: () => number): void {
  const elapsed = now() - t0;
  if (elapsed > RESTORE_SLOW_MS) {
    logger.warn({
      event: 'injection.clipboard.restore_slow',
      elapsed_ms: elapsed,
      threshold_ms: RESTORE_SLOW_MS,
    });
  }
}

/** Test helper: inject clipboard double pra próximas calls sem opts explícito. */
export function __setDefaultClipboardForTest(
  clipboard: ClipboardLike | null,
  factory: NativeImageFactory | null = null,
): void {
  defaultClipboard = clipboard;
  defaultNativeImageFactory = factory;
}
