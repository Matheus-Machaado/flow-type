import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';
import { SETTINGS_DEFAULTS } from '../../src/shared/db-types.js';

describe('SettingsRepo', () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns SETTINGS_DEFAULTS when key absent and no fallback', () => {
    // Drop seeded settings to force defaults path
    ctx.db.exec('DELETE FROM settings');
    ctx.settingsRepo.invalidate();
    expect(ctx.settingsRepo.get<string>('hotkey')).toBe('Right Ctrl');
    expect(ctx.settingsRepo.get<boolean>('stt_force_local')).toBe(false);
    expect(ctx.settingsRepo.get<unknown>('some_unknown_key', 'fallback-value')).toBe(
      'fallback-value',
    );
  });

  it('set persists and round-trips simple value', () => {
    ctx.settingsRepo.set('hotkey', 'F12');
    expect(ctx.settingsRepo.get<string>('hotkey')).toBe('F12');
    // Force reload via new instance
    ctx.settingsRepo.invalidate();
    expect(ctx.settingsRepo.get<string>('hotkey')).toBe('F12');
  });

  it('set persists arrays and objects (JSON serialization)', () => {
    ctx.settingsRepo.set('app_blacklist', ['foo.exe', 'bar.exe']);
    ctx.settingsRepo.invalidate();
    expect(ctx.settingsRepo.get<string[]>('app_blacklist')).toEqual(['foo.exe', 'bar.exe']);

    ctx.settingsRepo.set('overlay_custom_xy', [100, 200]);
    expect(ctx.settingsRepo.get('overlay_custom_xy')).toEqual([100, 200]);
  });

  it('set persists boolean and number', () => {
    ctx.settingsRepo.set('stt_force_local', true);
    expect(ctx.settingsRepo.get<boolean>('stt_force_local')).toBe(true);
    ctx.settingsRepo.set('hotkey_hold_min_ms', 500);
    expect(ctx.settingsRepo.get<number>('hotkey_hold_min_ms')).toBe(500);
  });

  it('set invalidates cache (next get returns new value)', () => {
    ctx.settingsRepo.set('muted', false);
    expect(ctx.settingsRepo.get<boolean>('muted')).toBe(false);
    ctx.settingsRepo.set('muted', true);
    expect(ctx.settingsRepo.get<boolean>('muted')).toBe(true);
  });

  it('reset(key) deletes that key (falls back to default)', () => {
    ctx.settingsRepo.set('hotkey', 'F12');
    expect(ctx.settingsRepo.get<string>('hotkey')).toBe('F12');
    ctx.settingsRepo.reset('hotkey');
    expect(ctx.settingsRepo.get<string>('hotkey')).toBe(SETTINGS_DEFAULTS.hotkey);
  });

  it('reset() repopulates SETTINGS_DEFAULTS', () => {
    ctx.settingsRepo.set('hotkey', 'F11');
    ctx.settingsRepo.set('stt_force_local', true);
    ctx.settingsRepo.reset();
    expect(ctx.settingsRepo.get<string>('hotkey')).toBe(SETTINGS_DEFAULTS.hotkey);
    expect(ctx.settingsRepo.get<boolean>('stt_force_local')).toBe(
      SETTINGS_DEFAULTS.stt_force_local as boolean,
    );
  });

  it('getAll merges defaults with persisted settings', () => {
    ctx.settingsRepo.set('hotkey', 'F8');
    const all = ctx.settingsRepo.getAll();
    expect(all.hotkey).toBe('F8');
    // Default ainda presente
    expect(all.smart_punctuation).toBe(true);
  });

  it('seed populates defaults on fresh DB', () => {
    // ctx already seeded; verify hotkey present
    const row = ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get('hotkey') as
      | { value: string }
      | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row!.value)).toBe('Right Ctrl');
  });
});
