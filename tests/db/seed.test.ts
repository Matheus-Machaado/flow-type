import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase, type DB } from '../../src/main/db/connection.js';
import { runMigrations } from '../../src/main/db/migrator.js';
import { runSeed } from '../../src/main/db/seed.js';
import { GroqSlotMetaRepo } from '../../src/main/repos/groq-slot-meta-repo.js';
import { SettingsRepo } from '../../src/main/repos/settings-repo.js';
import { MIGRATIONS_DIR } from '../helpers/test-db.js';

const tracked: { db: DB; dir: string }[] = [];

afterEach(() => {
  while (tracked.length) {
    const t = tracked.pop()!;
    try {
      t.db.close();
    } catch {
      /* ignore */
    }
    try {
      rmSync(t.dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  // Limpa env vars que possam ter sido setadas no teste
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY_LABEL_1;
  delete process.env.GROQ_API_KEY_2;
  delete process.env.GROQ_API_KEY_LABEL_2;
});

function fresh(): { db: DB; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'flowtype-seed-test-'));
  const db = openDatabase({ path: join(dir, 'db.sqlite') });
  runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
  tracked.push({ db, dir });
  return { db, dir };
}

describe('seed', () => {
  it('populates SETTINGS_DEFAULTS', () => {
    const { db } = fresh();
    const result = runSeed(db, { skipSecrets: true });
    expect(result.settingsInserted).toBeGreaterThan(0);
    const settingsRepo = new SettingsRepo(db);
    expect(settingsRepo.get<string>('hotkey')).toBe('Right Ctrl');
  });

  it('is idempotent (running 2x does not duplicate settings)', () => {
    const { db } = fresh();
    runSeed(db, { skipSecrets: true });
    const second = runSeed(db, { skipSecrets: true });
    expect(second.settingsInserted).toBe(0);
  });

  it('hydrates slot 0 from env file (GROQ_API_KEY + GROQ_API_KEY_LABEL_1)', () => {
    const { db, dir } = fresh();
    const envPath = join(dir, 'secrets.env');
    writeFileSync(
      envPath,
      `GROQ_API_KEY=gsk_test_from_env\nGROQ_API_KEY_LABEL_1=primary-flow\n`,
    );
    const result = runSeed(db, { secretsPath: envPath });
    expect(result.groqSlotsHydrated).toEqual([0]);

    const repo = new GroqSlotMetaRepo(db);
    const slot0 = repo.get(0);
    expect(slot0.api_key_encrypted).toBe('gsk_test_from_env');
    expect(slot0.label).toBe('primary-flow');
    expect(slot0.added_at).toBeTruthy();

    // Slots 1 e 2 ainda vazios
    expect(repo.get(1).api_key_encrypted).toBeNull();
    expect(repo.get(2).api_key_encrypted).toBeNull();
  });

  it('does NOT overwrite existing api_key when re-seeded', () => {
    const { db, dir } = fresh();
    const repo = new GroqSlotMetaRepo(db);
    repo.upsert(0, { api_key_encrypted: 'gsk_user_pasted_in_ui' });

    const envPath = join(dir, 'secrets.env');
    writeFileSync(envPath, `GROQ_API_KEY=gsk_from_env\n`);
    const result = runSeed(db, { secretsPath: envPath });
    expect(result.groqSlotsHydrated).toEqual([]); // não hidratou — já tinha

    expect(repo.get(0).api_key_encrypted).toBe('gsk_user_pasted_in_ui');
  });

  it('hydrates multiple slots from env when all 3 vars present', () => {
    const { db, dir } = fresh();
    const envPath = join(dir, 'secrets.env');
    writeFileSync(
      envPath,
      [
        'GROQ_API_KEY=gsk_a',
        'GROQ_API_KEY_LABEL_1=primary',
        'GROQ_API_KEY_2=gsk_b',
        'GROQ_API_KEY_LABEL_2=backup',
        'GROQ_API_KEY_3=gsk_c',
        'GROQ_API_KEY_LABEL_3=tertiary',
      ].join('\n'),
    );
    const result = runSeed(db, { secretsPath: envPath });
    expect(result.groqSlotsHydrated).toEqual([0, 1, 2]);

    const repo = new GroqSlotMetaRepo(db);
    expect(repo.get(0).api_key_encrypted).toBe('gsk_a');
    expect(repo.get(1).api_key_encrypted).toBe('gsk_b');
    expect(repo.get(2).api_key_encrypted).toBe('gsk_c');
    expect(repo.get(1).label).toBe('backup');
  });

  it('process.env takes precedence over .env file', () => {
    const { db, dir } = fresh();
    process.env.GROQ_API_KEY = 'gsk_from_process';
    const envPath = join(dir, 'secrets.env');
    writeFileSync(envPath, `GROQ_API_KEY=gsk_from_file\n`);
    runSeed(db, { secretsPath: envPath });

    const repo = new GroqSlotMetaRepo(db);
    expect(repo.get(0).api_key_encrypted).toBe('gsk_from_process');
  });

  it('skipSecrets=true does not load anything from env', () => {
    const { db, dir } = fresh();
    const envPath = join(dir, 'secrets.env');
    writeFileSync(envPath, `GROQ_API_KEY=gsk_should_be_ignored\n`);
    const result = runSeed(db, { secretsPath: envPath, skipSecrets: true });
    expect(result.groqSlotsHydrated).toEqual([]);
    expect(new GroqSlotMetaRepo(db).get(0).api_key_encrypted).toBeNull();
  });

  it('returns empty groqSlotsHydrated when no env file exists', () => {
    const { db, dir } = fresh();
    const result = runSeed(db, {
      secretsPath: join(dir, 'does-not-exist.env'),
    });
    expect(result.groqSlotsHydrated).toEqual([]);
  });
});
