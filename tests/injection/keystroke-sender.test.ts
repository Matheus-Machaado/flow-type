/**
 * Testes de KeystrokeSender (e3-paste-ctrl-v, e3-typing-simulation-fallback).
 *
 * Mock total do driver (nut.js não invocado): asserta combos corretos e
 * propagação de erros.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  KeystrokeSender,
  type KeyboardDriver,
  type KeyTokens,
} from '../../src/main/injection/keystroke-sender.js';
import { KeystrokeSendError } from '../../src/main/injection/injection-types.js';

const FAKE_KEYS: KeyTokens = {
  LeftControl: 'LCTRL',
  V: 'V',
  Enter: 'ENTER',
};

function makeDriver(overrides: Partial<KeyboardDriver> = {}): KeyboardDriver & {
  presses: unknown[][];
  releases: unknown[][];
  typed: string[];
} {
  const presses: unknown[][] = [];
  const releases: unknown[][] = [];
  const typed: string[] = [];
  const base: KeyboardDriver & {
    presses: unknown[][];
    releases: unknown[][];
    typed: string[];
  } = {
    presses,
    releases,
    typed,
    pressKey: async (...keys: unknown[]) => {
      presses.push(keys);
    },
    releaseKey: async (...keys: unknown[]) => {
      releases.push(keys);
    },
    type: async (text: string) => {
      typed.push(text);
    },
    config: { autoDelayMs: 0 },
  };
  return Object.assign(base, overrides) as KeyboardDriver & {
    presses: unknown[][];
    releases: unknown[][];
    typed: string[];
  };
}

describe('KeystrokeSender', () => {
  it('sendPaste: press [LCTRL, V] → sleep 80ms → release [V, LCTRL]', async () => {
    const driver = makeDriver();
    const sleepFn = vi.fn(async (_ms: number) => {});
    const sender = new KeystrokeSender({
      driver,
      keys: FAKE_KEYS,
      sleepFn,
    });
    await sender.sendPaste();
    expect(driver.presses).toEqual([['LCTRL', 'V']]);
    expect(driver.releases).toEqual([['V', 'LCTRL']]);
    expect(sleepFn).toHaveBeenCalledWith(80);
  });

  it('sendPaste com pasteHoldMs custom', async () => {
    const driver = makeDriver();
    const sleepFn = vi.fn(async (_ms: number) => {});
    const sender = new KeystrokeSender({
      driver,
      keys: FAKE_KEYS,
      sleepFn,
      pasteHoldMs: 200,
    });
    await sender.sendPaste();
    expect(sleepFn).toHaveBeenCalledWith(200);
  });

  it('sendPaste: driver throws → KeystrokeSendError + best-effort release', async () => {
    const driver = makeDriver({
      pressKey: async () => {
        throw new Error('binding broken');
      },
    });
    const sender = new KeystrokeSender({ driver, keys: FAKE_KEYS });
    await expect(sender.sendPaste()).rejects.toBeInstanceOf(KeystrokeSendError);
    // Tentou release no finally (defensive cleanup).
    expect(driver.releases.length).toBeGreaterThanOrEqual(1);
  });

  it('typeText: chama driver.type com texto unicode', async () => {
    const driver = makeDriver();
    const sender = new KeystrokeSender({ driver, keys: FAKE_KEYS });
    await sender.typeText('Olá ç ñ áé');
    expect(driver.typed).toEqual(['Olá ç ñ áé']);
  });

  it('typeText: configura autoDelayMs antes do type, reseta depois', async () => {
    const driver = makeDriver();
    const sender = new KeystrokeSender({ driver, keys: FAKE_KEYS, charDelayMs: 15 });
    await sender.typeText('abc');
    // autoDelayMs deve estar resetado pra 0 após o type.
    expect(driver.config?.autoDelayMs).toBe(0);
  });

  it('typeText vazio → no-op', async () => {
    const driver = makeDriver();
    const sender = new KeystrokeSender({ driver, keys: FAKE_KEYS });
    await sender.typeText('');
    expect(driver.typed).toEqual([]);
  });

  it('typeText: driver.type throws → KeystrokeSendError', async () => {
    const driver = makeDriver({
      type: async () => {
        throw new Error('boom');
      },
    });
    const sender = new KeystrokeSender({ driver, keys: FAKE_KEYS });
    await expect(sender.typeText('hi')).rejects.toBeInstanceOf(KeystrokeSendError);
  });
});
