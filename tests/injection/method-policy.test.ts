/**
 * Testes de decidePasteMethod (e3-app-whitelist-blacklist).
 *
 * Cobre: default global, overrides per-exe, blacklist throw,
 * compat legacy (app_blacklist/app_force_typing), defaults pré-configurados
 * (keepass/1password), case-insensitive matching.
 */

import { describe, expect, it } from 'vitest';
import {
  decidePasteMethod,
  DEFAULT_OVERRIDES,
} from '../../src/main/injection/method-policy.js';
import { InjectionBlockedByPolicy } from '../../src/main/injection/injection-types.js';

describe('decidePasteMethod', () => {
  it('default global = clipboard quando nenhum override', () => {
    expect(
      decidePasteMethod({
        exeName: 'notepad.exe',
        settings: {},
      }),
    ).toBe('clipboard');
  });

  it('respeita injection_method_default=typing global', () => {
    expect(
      decidePasteMethod({
        exeName: 'notepad.exe',
        settings: { injection_method_default: 'typing' },
      }),
    ).toBe('typing');
  });

  it('override per-exe sobrescreve default', () => {
    expect(
      decidePasteMethod({
        exeName: 'notepad.exe',
        settings: {
          injection_method_default: 'clipboard',
          injection_method_overrides: { 'notepad.exe': 'typing' },
        },
      }),
    ).toBe('typing');
  });

  it('default overrides incluem keepass e 1password como typing', () => {
    expect(DEFAULT_OVERRIDES['keepass.exe']).toBe('typing');
    expect(DEFAULT_OVERRIDES['1password.exe']).toBe('typing');
    expect(decidePasteMethod({ exeName: 'keepass.exe', settings: {} })).toBe('typing');
    expect(decidePasteMethod({ exeName: '1password.exe', settings: {} })).toBe('typing');
  });

  it('blacklist throws InjectionBlockedByPolicy', () => {
    expect(() =>
      decidePasteMethod({
        exeName: 'secret_app.exe',
        settings: { injection_blacklist: ['secret_app.exe'] },
      }),
    ).toThrow(InjectionBlockedByPolicy);
  });

  it('compat legacy: app_blacklist funciona como injection_blacklist', () => {
    expect(() =>
      decidePasteMethod({
        exeName: 'oldapp.exe',
        settings: { app_blacklist: ['oldapp.exe'] },
      }),
    ).toThrow(InjectionBlockedByPolicy);
  });

  it('compat legacy: app_force_typing entra como override typing', () => {
    expect(
      decidePasteMethod({
        exeName: 'cmd.exe',
        settings: { app_force_typing: ['cmd.exe'] },
      }),
    ).toBe('typing');
  });

  it('case-insensitive: NOTEPAD.EXE em override match notepad.exe', () => {
    expect(
      decidePasteMethod({
        exeName: 'NOTEPAD.EXE',
        settings: { injection_method_overrides: { 'notepad.exe': 'typing' } },
      }),
    ).toBe('typing');
  });

  it('exeName null → assume default', () => {
    expect(
      decidePasteMethod({
        exeName: null,
        settings: { injection_method_default: 'typing' },
      }),
    ).toBe('typing');
  });

  it('explicit override BEATS default DEFAULT_OVERRIDES', () => {
    expect(
      decidePasteMethod({
        exeName: 'keepass.exe',
        settings: { injection_method_overrides: { 'keepass.exe': 'clipboard' } },
      }),
    ).toBe('clipboard');
  });
});
