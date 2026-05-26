/**
 * Testes de refocusWindow (e3-refocus-target-window).
 */

import { describe, expect, it, vi } from 'vitest';
import { refocusWindow } from '../../src/main/injection/refocus-window.js';

describe('refocusWindow', () => {
  it('target null → false (sem exec)', async () => {
    const execFn = vi.fn();
    const out = await refocusWindow(null, {
      execFn: execFn as unknown as Parameters<typeof refocusWindow>[1]['execFn'],
      platform: 'win32',
    });
    expect(out).toBe(false);
    expect(execFn).not.toHaveBeenCalled();
  });

  it('hwnd 0 → false (sem exec)', async () => {
    const execFn = vi.fn();
    const out = await refocusWindow(
      { hwnd: 0, exeName: 'x.exe', windowTitle: '', processId: 1 },
      {
        execFn: execFn as unknown as Parameters<typeof refocusWindow>[1]['execFn'],
        platform: 'win32',
      },
    );
    expect(out).toBe(false);
    expect(execFn).not.toHaveBeenCalled();
  });

  it('macOS/Linux → false (não suportado)', async () => {
    const execFn = vi.fn();
    const out = await refocusWindow(
      { hwnd: 42, exeName: 'x.exe', windowTitle: '', processId: 1 },
      {
        execFn: execFn as unknown as Parameters<typeof refocusWindow>[1]['execFn'],
        platform: 'darwin',
      },
    );
    expect(out).toBe(false);
    expect(execFn).not.toHaveBeenCalled();
  });

  it('janela já em foco (getCurrentHwnd === target) → true sem exec', async () => {
    const execFn = vi.fn();
    const out = await refocusWindow(
      { hwnd: 42, exeName: 'x.exe', windowTitle: '', processId: 1 },
      {
        execFn: execFn as unknown as Parameters<typeof refocusWindow>[1]['execFn'],
        platform: 'win32',
        getCurrentHwnd: async () => 42,
      },
    );
    expect(out).toBe(true);
    expect(execFn).not.toHaveBeenCalled();
  });

  it('PowerShell ok → true', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    const out = await refocusWindow(
      { hwnd: 42, exeName: 'x.exe', windowTitle: '', processId: 1 },
      {
        execFn: execFn as unknown as Parameters<typeof refocusWindow>[1]['execFn'],
        platform: 'win32',
      },
    );
    expect(out).toBe(true);
    expect(execFn).toHaveBeenCalledOnce();
    const args = execFn.mock.calls[0];
    expect(args[0]).toBe('powershell');
    // -Hwnd 42 no comando.
    expect(args[1]).toContain('-Hwnd');
    expect(args[1]).toContain('42');
  });

  it('PowerShell fallback_ok → true', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: 'fallback_ok\n', stderr: '' });
    const out = await refocusWindow(
      { hwnd: 42, exeName: 'x.exe', windowTitle: '', processId: 1 },
      {
        execFn: execFn as unknown as Parameters<typeof refocusWindow>[1]['execFn'],
        platform: 'win32',
      },
    );
    expect(out).toBe(true);
  });

  it('PowerShell fallback_failed → false', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: 'fallback_failed\n', stderr: '' });
    const out = await refocusWindow(
      { hwnd: 42, exeName: 'x.exe', windowTitle: '', processId: 1 },
      {
        execFn: execFn as unknown as Parameters<typeof refocusWindow>[1]['execFn'],
        platform: 'win32',
      },
    );
    expect(out).toBe(false);
  });

  it('PowerShell throw (timeout) → false (não propaga)', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const out = await refocusWindow(
      { hwnd: 42, exeName: 'x.exe', windowTitle: '', processId: 1 },
      {
        execFn: execFn as unknown as Parameters<typeof refocusWindow>[1]['execFn'],
        platform: 'win32',
      },
    );
    expect(out).toBe(false);
  });
});
