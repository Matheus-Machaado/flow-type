/**
 * DB facade — boot a conexão, roda migrations, roda seed e devolve handle pronto.
 */

import { openDatabase, type DB, type OpenDatabaseOptions } from './connection.js';
import { runMigrations } from './migrator.js';
import { runSeed, type SeedOptions } from './seed.js';
import { TranscriptionRepo } from '../repos/transcription-repo.js';
import { VocabRepo } from '../repos/vocab-repo.js';
import { SettingsRepo } from '../repos/settings-repo.js';
import { TokenUsageRepo } from '../repos/token-usage-repo.js';
import { GroqSlotMetaRepo } from '../repos/groq-slot-meta-repo.js';

export interface BootDbOptions {
  open?: OpenDatabaseOptions;
  migrationsDir?: string;
  seed?: SeedOptions | false;
}

export interface BootDbResult {
  db: DB;
  transcriptionRepo: TranscriptionRepo;
  vocabRepo: VocabRepo;
  settingsRepo: SettingsRepo;
  tokenUsageRepo: TokenUsageRepo;
  groqSlotMetaRepo: GroqSlotMetaRepo;
}

export function bootDb(opts: BootDbOptions = {}): BootDbResult {
  const db = openDatabase(opts.open);
  runMigrations(db, { migrationsDir: opts.migrationsDir });
  if (opts.seed !== false) {
    runSeed(db, opts.seed ?? {});
  }
  return {
    db,
    transcriptionRepo: new TranscriptionRepo(db),
    vocabRepo: new VocabRepo(db),
    settingsRepo: new SettingsRepo(db),
    tokenUsageRepo: new TokenUsageRepo(db),
    groqSlotMetaRepo: new GroqSlotMetaRepo(db),
  };
}

export { openDatabase, runMigrations, runSeed };
export type { DB };
