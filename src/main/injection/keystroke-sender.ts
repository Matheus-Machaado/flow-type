/**
 * KeystrokeSender — wrapper testável sobre nut.js (ADR-09).
 *
 * Métodos:
 *  - sendPaste(): Promise<void>  → Ctrl+V (LeftControl + V press/release).
 *  - typeText(text, opts): Promise<void>  → char-por-char com delay (default 8ms).
 *
 * Cobre e3-paste-ctrl-v + e3-typing-simulation-fallback.
 *
 * Design:
 *  - Carregamento preguiçoso do nut.js (require dinâmico) pra não crashar
 *    ambientes de teste/CI sem o native binding (graceful fallback: logger.warn
 *    + throw KeystrokeSendError).
 *  - Aceita injeção de driver `KeyboardDriver` pra testes — usamos isso pra
 *    afirmar combos sem precisar do binding real.
 *  - Unicode/acentos: nut.js `keyboard.type(text)` suporta nativamente.
 *  - Newlines: keyboard.type respeita `\n` em apps que aceitam.
 *  - Mac requer Accessibility permission (documentar no FAQ).
 */

import { logger } from '../utils/logger.js';
import { KeystrokeSendError } from './injection-types.js';

/**
 * Abstração mínima do nut.js que usamos. Permite injeção total pra testes.
 */
export interface KeyboardDriver {
  pressKey(...keys: unknown[]): Promise<void>;
  releaseKey(...keys: unknown[]): Promise<void>;
  type(text: string): Promise<void>;
  /** Configuração opcional do delay entre chars no `type`. */
  config?: { autoDelayMs?: number };
}

/**
 * Resolução do `Key` enum (constantes LEFTCONTROL / V / ENTER do nut.js).
 * Em testes injetamos um objeto fake.
 */
export interface KeyTokens {
  LeftControl: unknown;
  V: unknown;
  Enter: unknown;
}

let cachedDriver: KeyboardDriver | null = null;
let cachedKeys: KeyTokens | null = null;
let driverLoadFailed: Error | null = null;

/**
 * Carrega nut.js preguiçosamente. Em ambientes sem o binding, registra
 * a falha e re-throw em chamadas subsequentes (não tentamos a cada call).
 */
async function loadNutJsDriver(): Promise<{ driver: KeyboardDriver; keys: KeyTokens }> {
  if (cachedDriver && cachedKeys) return { driver: cachedDriver, keys: cachedKeys };
  if (driverLoadFailed) throw driverLoadFailed;
  try {
    // Require dinâmico — evita crash em ambientes (CI Linux sem binding pré-built).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@nut-tree-fork/nut-js') as {
      keyboard: KeyboardDriver;
      Key: KeyTokens & Record<string, unknown>;
    };
    cachedDriver = mod.keyboard;
    cachedKeys = {
      LeftControl: mod.Key.LeftControl,
      V: mod.Key.V,
      Enter: mod.Key.Enter,
    };
    if (cachedDriver.config) {
      // Default autoDelayMs = 0 pra velocidade. Cada call pode subir.
      cachedDriver.config.autoDelayMs = 0;
    }
    return { driver: cachedDriver, keys: cachedKeys };
  } catch (err) {
    const wrapped = new KeystrokeSendError(
      `Falha carregando nut.js: ${(err as Error).message}`,
    );
    driverLoadFailed = wrapped;
    logger.error({
      event: 'injection.keystroke.driver_load_failed',
      error: wrapped.message,
    });
    throw wrapped;
  }
}

export interface KeystrokeSenderOptions {
  /** Driver injetado (testes); default carrega nut.js preguiçosamente. */
  driver?: KeyboardDriver;
  /** Tokens de tecla injetados (testes); default usa Key.* do nut.js. */
  keys?: KeyTokens;
  /** Delay entre press e release no Ctrl+V (default 80ms — alguns apps precisam). */
  pasteHoldMs?: number;
  /** Delay entre chars no typeText (default 8ms). */
  charDelayMs?: number;
  /** Override do sleep (testes). */
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_PASTE_HOLD_MS = 80;
const DEFAULT_CHAR_DELAY_MS = 8;

export class KeystrokeSender {
  private readonly pasteHoldMs: number;
  private readonly charDelayMs: number;
  private readonly injectedDriver?: KeyboardDriver;
  private readonly injectedKeys?: KeyTokens;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(opts: KeystrokeSenderOptions = {}) {
    this.injectedDriver = opts.driver;
    this.injectedKeys = opts.keys;
    this.pasteHoldMs = opts.pasteHoldMs ?? DEFAULT_PASTE_HOLD_MS;
    this.charDelayMs = opts.charDelayMs ?? DEFAULT_CHAR_DELAY_MS;
    this.sleepFn =
      opts.sleepFn ??
      ((ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms)));
  }

  /** Press LeftControl + V, sleep 80ms, release. */
  async sendPaste(): Promise<void> {
    const { driver, keys } = await this.resolve();
    try {
      await driver.pressKey(keys.LeftControl, keys.V);
      await this.sleepFn(this.pasteHoldMs);
      await driver.releaseKey(keys.V, keys.LeftControl);
    } catch (err) {
      logger.error({
        event: 'injection.keystroke.paste_failed',
        error: (err as Error).message,
      });
      // Best-effort release pra não deixar tecla "presa".
      try {
        await driver.releaseKey(keys.V, keys.LeftControl);
      } catch {
        /* swallow */
      }
      throw new KeystrokeSendError(`Falha no Ctrl+V: ${(err as Error).message}`);
    }
  }

  /**
   * Digita texto char-por-char (nut.js.type respeita unicode/acentos).
   * Usa charDelayMs configurado (default 8ms).
   */
  async typeText(text: string, opts: { charDelayMs?: number } = {}): Promise<void> {
    if (!text) return;
    const delay = opts.charDelayMs ?? this.charDelayMs;
    const { driver } = await this.resolve();
    try {
      if (driver.config) driver.config.autoDelayMs = delay;
      await driver.type(text);
    } catch (err) {
      logger.error({
        event: 'injection.keystroke.type_failed',
        error: (err as Error).message,
        text_len: text.length,
      });
      throw new KeystrokeSendError(`Falha em typeText: ${(err as Error).message}`);
    } finally {
      if (driver.config) driver.config.autoDelayMs = 0;
    }
  }

  private async resolve(): Promise<{ driver: KeyboardDriver; keys: KeyTokens }> {
    if (this.injectedDriver && this.injectedKeys) {
      return { driver: this.injectedDriver, keys: this.injectedKeys };
    }
    if (this.injectedDriver) {
      const { keys } = await loadNutJsDriver();
      return { driver: this.injectedDriver, keys };
    }
    return loadNutJsDriver();
  }
}

/** Test helper: zera o cache do driver lazy-loaded. */
export function __resetKeystrokeSenderForTest(): void {
  cachedDriver = null;
  cachedKeys = null;
  driverLoadFailed = null;
}
