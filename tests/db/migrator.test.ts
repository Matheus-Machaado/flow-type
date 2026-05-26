import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase, type DB } from '../../src/main/db/connection.js';
import { listApplied, runMigrations } from '../../src/main/db/migrator.js';
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
});

function fresh(): { db: DB; dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'flowtype-migrator-test-'));
  const dbPath = join(dir, 'db.sqlite');
  const db = openDatabase({ path: dbPath });
  tracked.push({ db, dir });
  return { db, dir, dbPath };
}

describe('migrator', () => {
  it('applies all migrations on fresh DB', () => {
    const { db } = fresh();
    const applied = runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
    expect(applied).toContain('0001_initial');
    const list = listApplied(db);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].name).toBe('0001_initial');
  });

  it('is idempotent (running 2x does not re-apply)', () => {
    const { db } = fresh();
    const first = runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
    expect(first.length).toBeGreaterThan(0);
    const second = runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
    expect(second).toEqual([]);
  });

  it('creates the expected tables and FTS virtual table', () => {
    const { db } = fresh();
    runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name`)
      .all()
      .map((r) => (r as { name: string }).name);

    for (const expected of [
      '_migrations',
      'groq_slot_meta',
      'settings',
      'token_usage',
      'transcription',
      'transcription_fts',
      'vocab_entry',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('seeds the 3 fixed groq_slot_meta rows', () => {
    const { db } = fresh();
    runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
    const count = (db.prepare('SELECT COUNT(*) AS n FROM groq_slot_meta').get() as {
      n: number;
    }).n;
    expect(count).toBe(3);
  });

  it('aborts and throws on broken migration', () => {
    const { db, dir } = fresh();
    const customDir = join(dir, 'migrations');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      join(customDir, '0001_initial.sql'),
      `BEGIN;
       CREATE TABLE t (id INTEGER);
       COMMIT;`,
    );
    writeFileSync(
      join(customDir, '0002_broken.sql'),
      `BEGIN;
       CREATE TABLE bad ();   -- syntax error
       COMMIT;`,
    );
    expect(() => runMigrations(db, { migrationsDir: customDir })).toThrow(/0002_broken/);
    const applied = listApplied(db).map((r) => r.name);
    expect(applied).toContain('0001_initial');
    expect(applied).not.toContain('0002_broken');
  });

  it('applies new migrations added later without rerunning old ones', () => {
    const { db, dir } = fresh();
    const customDir = join(dir, 'migrations');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      join(customDir, '0001_initial.sql'),
      `BEGIN;
       CREATE TABLE a (id INTEGER PRIMARY KEY);
       COMMIT;`,
    );
    const first = runMigrations(db, { migrationsDir: customDir });
    expect(first).toEqual(['0001_initial']);

    writeFileSync(
      join(customDir, '0002_add_b.sql'),
      `BEGIN;
       CREATE TABLE b (id INTEGER PRIMARY KEY);
       COMMIT;`,
    );
    const second = runMigrations(db, { migrationsDir: customDir });
    expect(second).toEqual(['0002_add_b']);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('a');
    expect(tables).toContain('b');
  });
});
