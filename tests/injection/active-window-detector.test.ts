/**
 * Testes de ActiveWindowDetector (e3-active-window-detection).
 *
 * Cobre: parse de JSON do PowerShell, cache TTL, retorno null em
 * plataformas não-Windows, dedup de chamadas concorrentes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActiveWindowDetector,
  parseWindowInfo,
} from '../../src/main/injection/active-window-detector.js';

describe('parseWindowInfo', () => {
  it('parse JSON válido', () => {
    const stdout = '{"exeName":"notepad.exe","windowTitle":"Sem título","processId":1234,"hwnd":987654}';
    expect(parseWindowInfo(stdout)).toEqual({
      exeName: 'notepad.exe',
      windowTitle: 'Sem título',
      processId: 1234,
      hwnd: 987654,
    });
  });

  it('parse com extra whitespace funciona', () => {
    const stdout = '   \n{"exeName":"foo.exe","windowTitle":"","processId":1,"hwnd":42}\n  ';
    expect(parseWindowInfo(stdout)).toEqual({
      exeName: 'foo.exe',
      windowTitle: '',
      processId: 1,
      hwnd: 42,
    });
  });

  it('hwnd 0 ou negativo → null', () => {
    expect(parseWindowInfo('{"exeName":"x","windowTitle":"","processId":1,"hwnd":0}')).toBeNull();
    expect(parseWindowInfo('{"exeName":"x","windowTitle":"","processId":1,"hwnd":-1}')).toBeNull();
  });

  it('JSON malformado → null (não throw)', () => {
    expect(parseWindowInfo('not-json')).toBeNull();
    expect(parseWindowInfo('{broken')).toBeNull();
  });

  it('string vazia → null', () => {
    expect(parseWindowInfo('')).toBeNull();
    expect(parseWindowInfo('   ')).toBeNull();
  });

  it('normaliza exeName para lowercase', () => {
    const out = parseWindowInfo(
      '{"exeName":"NOTEPAD.EXE","windowTitle":"","processId":1,"hwnd":42}',
    );
    expect(out?.exeName).toBe('notepad.exe');
  });
});

describe('ActiveWindowDetector', () => {
  let execFn: ReturnType<typeof vi.fn>;
  let nowFn: ReturnType<typeof vi.fn>;
  let currentTime: number;

  beforeEach(() => {
    currentTime = 1000;
    nowFn = vi.fn(() => currentTime);
    execFn = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Windows: spawn PowerShell e retorna parsed WindowInfo', async () => {
    execFn.mockResolvedValueOnce({
      stdout: '{"exeName":"chrome.exe","windowTitle":"Tab","processId":99,"hwnd":111}',
      stderr: '',
    });
    const detector = new ActiveWindowDetector({
      platform: 'win32',
      execFn: execFn as unknown as ActiveWindowDetector['execFn'],
      now: nowFn,
    });
    const out = await detector.getActiveWindow();
    expect(execFn).toHaveBeenCalledOnce();
    const args = execFn.mock.calls[0];
    expect(args[0]).toBe('powershell');
    expect(args[1]).toContain('-NoProfile');
    expect(out).toEqual({
      exeName: 'chrome.exe',
      windowTitle: 'Tab',
      processId: 99,
      hwnd: 111,
    });
  });

  it('cache TTL: 2 calls dentro do TTL → 1 exec', async () => {
    execFn.mockResolvedValue({
      stdout: '{"exeName":"x.exe","windowTitle":"","processId":1,"hwnd":42}',
      stderr: '',
    });
    const detector = new ActiveWindowDetector({
      platform: 'win32',
      execFn: execFn as unknown as ActiveWindowDetector['execFn'],
      now: nowFn,
      cacheTtlMs: 100,
    });
    await detector.getActiveWindow();
    currentTime += 50;
    await detector.getActiveWindow();
    expect(execFn).toHaveBeenCalledOnce();
  });

  it('cache expira após TTL → 2º exec', async () => {
    execFn.mockResolvedValue({
      stdout: '{"exeName":"x.exe","windowTitle":"","processId":1,"hwnd":42}',
      stderr: '',
    });
    const detector = new ActiveWindowDetector({
      platform: 'win32',
      execFn: execFn as unknown as ActiveWindowDetector['execFn'],
      now: nowFn,
      cacheTtlMs: 100,
    });
    await detector.getActiveWindow();
    currentTime += 200;
    await detector.getActiveWindow();
    expect(execFn).toHaveBeenCalledTimes(2);
  });

  it('macOS/Linux retorna null + não chama exec', async () => {
    const detector = new ActiveWindowDetector({
      platform: 'darwin',
      execFn: execFn as unknown as ActiveWindowDetector['execFn'],
      now: nowFn,
    });
    const out = await detector.getActiveWindow();
    expect(out).toBeNull();
    expect(execFn).not.toHaveBeenCalled();
  });

  it('timeout/erro do PowerShell → retorna null (graceful)', async () => {
    execFn.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const detector = new ActiveWindowDetector({
      platform: 'win32',
      execFn: execFn as unknown as ActiveWindowDetector['execFn'],
      now: nowFn,
    });
    const out = await detector.getActiveWindow();
    expect(out).toBeNull();
  });

  it('dedup de chamadas concorrentes: 5 calls paralelas → 1 exec', async () => {
    execFn.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                stdout: '{"exeName":"x.exe","windowTitle":"","processId":1,"hwnd":42}',
                stderr: '',
              }),
            10,
          ),
        ),
    );
    const detector = new ActiveWindowDetector({
      platform: 'win32',
      execFn: execFn as unknown as ActiveWindowDetector['execFn'],
      now: nowFn,
    });
    const results = await Promise.all([
      detector.getActiveWindow(),
      detector.getActiveWindow(),
      detector.getActiveWindow(),
      detector.getActiveWindow(),
      detector.getActiveWindow(),
    ]);
    expect(execFn).toHaveBeenCalledOnce();
    results.forEach((r) => expect(r?.hwnd).toBe(42));
  });

  it('invalidateCache() força próximo call a exec novamente', async () => {
    execFn.mockResolvedValue({
      stdout: '{"exeName":"x.exe","windowTitle":"","processId":1,"hwnd":42}',
      stderr: '',
    });
    const detector = new ActiveWindowDetector({
      platform: 'win32',
      execFn: execFn as unknown as ActiveWindowDetector['execFn'],
      now: nowFn,
    });
    await detector.getActiveWindow();
    detector.invalidateCache();
    await detector.getActiveWindow();
    expect(execFn).toHaveBeenCalledTimes(2);
  });
});
