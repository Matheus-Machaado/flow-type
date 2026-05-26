/**
 * TextInjector — pipeline principal de injeção (e3-clipboard-paste-pipeline).
 *
 * Pipeline:
 *   1. snapshot targetWindow via ActiveWindowDetector (ANTES de tudo).
 *   2. decidePasteMethod(targetWindow + settings) — pode throw InjectionBlockedByPolicy.
 *   3. text vazio/whitespace → method='noop', success=true.
 *   4. applyPunctuationHeuristic se habilitado.
 *   5. Branch CLIPBOARD:
 *      a. snapshot clipboard atual.
 *      b. clipboard.writeText(textoProcessado).
 *      c. refocusWindow(targetWindow).
 *      d. sendPaste() (Ctrl+V).
 *      e. sleep ~80ms (deixar app processar paste).
 *      f. restoreClipboard(snapshot) — em FINALLY.
 *   6. Branch TYPING:
 *      a. refocusWindow(targetWindow).
 *      b. typeText(textoProcessado, { charDelayMs: 8 }).
 *   7. Catch errors → log + return { success: false, errorReason }.
 *      NÃO throw — UX precisa de graceful degradation.
 *
 * Settings consumidas (todas via settings.get):
 *   - injection_method_default | app_force_typing (legacy)
 *   - injection_method_overrides
 *   - injection_blacklist | app_blacklist (legacy)
 *   - smart_punctuation (boolean, default true)
 *   - punctuation_smart_enabled (alias, opcional)
 *
 * Logging:
 *   - Texto NUNCA loggado completo. Apenas primeiros 30 chars + length.
 */

import { logger } from '../utils/logger.js';
import type { SettingsRepo } from '../repos/settings-repo.js';
import {
  InjectionBlockedByPolicy,
  KeystrokeSendError,
  type ClipboardSnapshot,
  type InjectionMethod,
  type PasteResult,
  type TextInjectorContract,
  type WindowDetector,
  type WindowInfo,
} from './injection-types.js';
import { decidePasteMethod } from './method-policy.js';
import { applyPunctuationHeuristic } from './punctuation-heuristic.js';
import {
  restoreClipboard,
  snapshotClipboard,
  type ClipboardLike,
  type NativeImageFactory,
} from './clipboard-state.js';
import { refocusWindow } from './refocus-window.js';
import { KeystrokeSender } from './keystroke-sender.js';

const DEFAULT_POST_PASTE_SLEEP_MS = 80;

export interface TextInjectorOptions {
  /** Função custom pra enviar Ctrl+V (default: KeystrokeSender.sendPaste). */
  sendPasteFn?: () => Promise<void>;
  /** Função custom pra typeText (default: KeystrokeSender.typeText). */
  typeTextFn?: (text: string, opts?: { charDelayMs?: number }) => Promise<void>;
  /** Sleep override (testes). */
  sleepFn?: (ms: number) => Promise<void>;
  /** Clipboard override (testes — evita require do electron real). */
  clipboard?: ClipboardLike;
  /** NativeImage factory override (testes). */
  nativeImage?: NativeImageFactory;
  /** Override do refocus (testes). */
  refocusFn?: (target: WindowInfo | null) => Promise<boolean>;
  /** Override do clock (testes). */
  now?: () => number;
  /** Sleep pós-paste (default 80ms — alguns apps precisam). */
  postPasteSleepMs?: number;
  /** Override do KeystrokeSender (raramente usado — testes preferem `sendPasteFn`/`typeTextFn`). */
  keystrokeSender?: KeystrokeSender;
}

export class TextInjector implements TextInjectorContract {
  private readonly sendPasteFn: () => Promise<void>;
  private readonly typeTextFn: (
    text: string,
    opts?: { charDelayMs?: number },
  ) => Promise<void>;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly clipboard?: ClipboardLike;
  private readonly nativeImage?: NativeImageFactory;
  private readonly refocusFn: (target: WindowInfo | null) => Promise<boolean>;
  private readonly now: () => number;
  private readonly postPasteSleepMs: number;

  constructor(
    private readonly activeWindowDetector: WindowDetector,
    private readonly settings: SettingsRepo,
    opts: TextInjectorOptions = {},
  ) {
    const sender = opts.keystrokeSender ?? new KeystrokeSender();
    this.sendPasteFn = opts.sendPasteFn ?? (() => sender.sendPaste());
    this.typeTextFn = opts.typeTextFn ?? ((text, o) => sender.typeText(text, o));
    this.sleepFn =
      opts.sleepFn ?? ((ms) => new Promise((res) => setTimeout(res, ms)));
    this.clipboard = opts.clipboard;
    this.nativeImage = opts.nativeImage;
    this.refocusFn = opts.refocusFn ?? ((target) => refocusWindow(target));
    this.now = opts.now ?? (() => Date.now());
    this.postPasteSleepMs = opts.postPasteSleepMs ?? DEFAULT_POST_PASTE_SLEEP_MS;
  }

  async paste(text: string): Promise<PasteResult> {
    const t0 = this.now();
    const targetWindow = await this.safeDetectWindow();

    // ── 1) Empty text → noop early ────────────────────────────────────
    const isEmpty = !text || text.trim().length === 0;
    if (isEmpty) {
      return {
        method: 'noop',
        success: true,
        targetWindow,
        refocused: false,
        latencyMs: this.now() - t0,
      };
    }

    // ── 2) Decide method via policy (pode throw blocked) ─────────────
    let method: InjectionMethod;
    try {
      method = decidePasteMethod({
        exeName: targetWindow?.exeName ?? null,
        settings: this.readPolicySettings(),
      });
    } catch (err) {
      if (err instanceof InjectionBlockedByPolicy) {
        logger.info({
          event: 'injection.blocked_by_policy',
          exe: err.exeName,
        });
        return {
          method: 'clipboard', // would-have-been
          success: false,
          targetWindow,
          refocused: false,
          blocked: true,
          errorReason: `App bloqueado por policy: ${err.exeName}`,
          latencyMs: this.now() - t0,
        };
      }
      throw err;
    }

    // ── 3) Apply punctuation heuristic if enabled ────────────────────
    const punctuationEnabled =
      this.settings.get<boolean>('smart_punctuation', true) === true &&
      this.settings.get<boolean>('punctuation_smart_enabled', true) === true;
    const processedText = applyPunctuationHeuristic(text, {
      enabled: punctuationEnabled,
    });

    logger.info({
      event: 'injection.paste.start',
      method,
      exe: targetWindow?.exeName ?? null,
      text_preview: processedText.slice(0, 30),
      text_len: processedText.length,
    });

    if (method === 'clipboard') {
      return this.pasteViaClipboard(processedText, targetWindow, t0);
    }
    return this.pasteViaTyping(processedText, targetWindow, t0);
  }

  // ── Branches ─────────────────────────────────────────────────────────

  private async pasteViaClipboard(
    text: string,
    targetWindow: WindowInfo | null,
    t0: number,
  ): Promise<PasteResult> {
    let snapshot: ClipboardSnapshot | null = null;
    let refocused = false;
    try {
      snapshot = snapshotClipboard(this.clipboard);
      // Write antes do refocus pra paste pegar o conteúdo já no clipboard.
      this.writeClipboardText(text);
      refocused = await this.refocusFn(targetWindow);
      await this.sendPasteFn();
      await this.sleepFn(this.postPasteSleepMs);
      return {
        method: 'clipboard',
        success: true,
        targetWindow,
        refocused,
        latencyMs: this.now() - t0,
      };
    } catch (err) {
      logger.error({
        event: 'injection.paste.clipboard_failed',
        exe: targetWindow?.exeName ?? null,
        error: (err as Error).message,
      });
      return {
        method: 'clipboard',
        success: false,
        targetWindow,
        refocused,
        errorReason: errorReasonFromException(err),
        latencyMs: this.now() - t0,
      };
    } finally {
      // Restore SEMPRE — mesmo se sendPaste falhou.
      if (snapshot) {
        try {
          restoreClipboard(snapshot, {
            clipboard: this.clipboard,
            nativeImage: this.nativeImage,
            now: this.now,
          });
        } catch (err) {
          logger.warn({
            event: 'injection.paste.restore_failed',
            error: (err as Error).message,
          });
        }
      }
    }
  }

  private async pasteViaTyping(
    text: string,
    targetWindow: WindowInfo | null,
    t0: number,
  ): Promise<PasteResult> {
    let refocused = false;
    try {
      refocused = await this.refocusFn(targetWindow);
      await this.typeTextFn(text, { charDelayMs: 8 });
      return {
        method: 'typing',
        success: true,
        targetWindow,
        refocused,
        latencyMs: this.now() - t0,
      };
    } catch (err) {
      logger.error({
        event: 'injection.paste.typing_failed',
        exe: targetWindow?.exeName ?? null,
        error: (err as Error).message,
      });
      return {
        method: 'typing',
        success: false,
        targetWindow,
        refocused,
        errorReason: errorReasonFromException(err),
        latencyMs: this.now() - t0,
      };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private async safeDetectWindow(): Promise<WindowInfo | null> {
    try {
      return await this.activeWindowDetector.getActiveWindow();
    } catch (err) {
      logger.warn({
        event: 'injection.detect_window_failed',
        error: (err as Error).message,
      });
      return null;
    }
  }

  private writeClipboardText(text: string): void {
    if (this.clipboard) {
      this.clipboard.writeText(text);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { clipboard } = require('electron') as { clipboard: ClipboardLike };
    clipboard.writeText(text);
  }

  private readPolicySettings(): Parameters<typeof decidePasteMethod>[0]['settings'] {
    return {
      injection_method_default: this.settings.get<InjectionMethod>(
        'injection_method_default',
        'clipboard',
      ),
      injection_method_overrides: this.settings.get<Record<string, InjectionMethod>>(
        'injection_method_overrides',
        {},
      ),
      injection_blacklist: this.settings.get<string[]>('injection_blacklist', []),
      app_blacklist: this.settings.get<string[]>('app_blacklist', []),
      app_force_typing: this.settings.get<string[]>('app_force_typing', []),
    };
  }
}

function errorReasonFromException(err: unknown): string {
  if (err instanceof KeystrokeSendError) return err.message;
  return (err as Error)?.message ?? 'erro desconhecido';
}
