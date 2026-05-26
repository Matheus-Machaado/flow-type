/**
 * Helper de testes: cria DB temporário, roda migrations e devolve repos prontos.
 * Usa arquivo temp em `os.tmpdir()/flowtype-test-<ulid>.sqlite` por suite.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { openDatabase, type DB } from '../../src/main/db/connection.js';
import { runMigrations } from '../../src/main/db/migrator.js';
import { runSeed } from '../../src/main/db/seed.js';

import { TranscriptionRepo } from '../../src/main/repos/transcription-repo.js';
import { VocabRepo } from '../../src/main/repos/vocab-repo.js';
import { SettingsRepo } from '../../src/main/repos/settings-repo.js';
import { TokenUsageRepo } from '../../src/main/repos/token-usage-repo.js';
import { GroqSlotMetaRepo } from '../../src/main/repos/groq-slot-meta-repo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '..', '..', 'src', 'main', 'db', 'migrations');

export interface TestDbContext {
  db: DB;
  dir: string;
  dbPath: string;
  transcriptionRepo: TranscriptionRepo;
  vocabRepo: VocabRepo;
  settingsRepo: SettingsRepo;
  tokenUsageRepo: TokenUsageRepo;
  groqSlotMetaRepo: GroqSlotMetaRepo;
  cleanup: () => void;
}

export interface CreateTestDbOptions {
  /** Roda seed (settings defaults) — default true. */
  seed?: boolean;
}

export function createTestDb(opts: CreateTestDbOptions = {}): TestDbContext {
  const dir = mkdtempSync(join(tmpdir(), 'flowtype-test-'));
  const dbPath = join(dir, 'db.sqlite');
  const db = openDatabase({ path: dbPath });
  runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
  if (opts.seed !== false) {
    runSeed(db, { skipSecrets: true });
  }

  const cleanup = () => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  return {
    db,
    dir,
    dbPath,
    transcriptionRepo: new TranscriptionRepo(db),
    vocabRepo: new VocabRepo(db),
    settingsRepo: new SettingsRepo(db),
    tokenUsageRepo: new TokenUsageRepo(db),
    groqSlotMetaRepo: new GroqSlotMetaRepo(db),
    cleanup,
  };
}

export { MIGRATIONS_DIR };
