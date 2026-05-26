/**
 * Seed inicial após migrations:
 *   1. Popula `settings` com SETTINGS_DEFAULTS (sem sobrescrever os já existentes).
 *   2. Hidrata slot 0 do `groq_slot_meta` a partir do .env (GROQ_API_KEY +
 *      GROQ_API_KEY_LABEL_1) se a coluna ainda estiver vazia.
 *
 * Também tenta hidratar slots 1 e 2 (GROQ_API_KEY_2/3 + LABEL_{2,3}) quando
 * presentes — útil pra dev que já tem múltiplas keys provisionadas.
 *
 * Idempotente: rodar 2x não duplica nem reescreve key existente.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { DB } from './connection.js';
import { SETTINGS_DEFAULTS } from '../../shared/db-types.js';
import { logger } from '../utils/logger.js';

export interface SeedOptions {
  /** Path do .env com GROQ_API_KEY*. Default: .studio/local/flowtype-secrets.env em dev, %APPDATA%/flowtype/secrets.env em prod. */
  secretsPath?: string;
  /** Se true, NÃO carrega secrets do disco (só seeds de settings). Útil em testes. */
  skipSecrets?: boolean;
}

export interface SeedResult {
  settingsInserted: number;
  groqSlotsHydrated: number[];
}

export function runSeed(db: DB, opts: SeedOptions = {}): SeedResult {
  const settingsInserted = seedSettings(db);
  const groqSlotsHydrated = opts.skipSecrets
    ? []
    : seedGroqSlotsFromEnv(db, opts.secretsPath);

  logger.info({
    event: 'seed.completed',
    settingsInserted,
    groqSlotsHydrated,
  });

  return { settingsInserted, groqSlotsHydrated };
}

function seedSettings(db: DB): number {
  // INSERT OR IGNORE preserva valores já gravados por outras fontes (UI/import).
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  );
  let count = 0;
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
      const info = stmt.run(key, JSON.stringify(value));
      if (info.changes > 0) count++;
    }
  });
  tx();
  return count;
}

function seedGroqSlotsFromEnv(db: DB, secretsPath?: string): number[] {
  const env = loadEnvFile(secretsPath);

  // Merge env vars do processo (precedence) com .env file (fallback).
  const merged: Record<string, string | undefined> = {
    GROQ_API_KEY: process.env.GROQ_API_KEY ?? env.GROQ_API_KEY,
    GROQ_API_KEY_LABEL_1: process.env.GROQ_API_KEY_LABEL_1 ?? env.GROQ_API_KEY_LABEL_1,
    GROQ_API_KEY_2: process.env.GROQ_API_KEY_2 ?? env.GROQ_API_KEY_2,
    GROQ_API_KEY_LABEL_2: process.env.GROQ_API_KEY_LABEL_2 ?? env.GROQ_API_KEY_LABEL_2,
    GROQ_API_KEY_3: process.env.GROQ_API_KEY_3 ?? env.GROQ_API_KEY_3,
    GROQ_API_KEY_LABEL_3: process.env.GROQ_API_KEY_LABEL_3 ?? env.GROQ_API_KEY_LABEL_3,
  };

  const hydrated: number[] = [];
  const slots: { idx: 0 | 1 | 2; key?: string; label?: string }[] = [
    { idx: 0, key: merged.GROQ_API_KEY, label: merged.GROQ_API_KEY_LABEL_1 },
    { idx: 1, key: merged.GROQ_API_KEY_2, label: merged.GROQ_API_KEY_LABEL_2 },
    { idx: 2, key: merged.GROQ_API_KEY_3, label: merged.GROQ_API_KEY_LABEL_3 },
  ];

  const existingStmt = db.prepare(
    'SELECT api_key_encrypted FROM groq_slot_meta WHERE slot_index = ?',
  );
  const updateStmt = db.prepare(
    `UPDATE groq_slot_meta
       SET api_key_encrypted = ?,
           label = ?,
           added_at = datetime('now')
     WHERE slot_index = ? AND api_key_encrypted IS NULL`,
  );

  for (const slot of slots) {
    if (!slot.key) continue;
    const row = existingStmt.get(slot.idx) as { api_key_encrypted: string | null } | undefined;
    if (row && row.api_key_encrypted) {
      logger.debug({ event: 'seed.groq_slot.skip_existing', slot: slot.idx });
      continue;
    }
    const info = updateStmt.run(slot.key, slot.label ?? null, slot.idx);
    if (info.changes > 0) {
      hydrated.push(slot.idx);
      logger.info({
        event: 'seed.groq_slot.hydrated',
        slot: slot.idx,
        label: slot.label ?? null,
      });
    }
  }

  return hydrated;
}

/**
 * Parser .env mínimo (sem deps externas). Aceita `KEY=value`, ignora comentários
 * `#` e linhas vazias. Não interpreta aspas (valor é raw após `=`).
 */
function loadEnvFile(explicit?: string): Record<string, string> {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);

  // Dev fallback
  if (process.env.FLOWTYPE_SECRETS_PATH) candidates.push(process.env.FLOWTYPE_SECRETS_PATH);

  for (const path of candidates) {
    if (!path) continue;
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf-8');
      return parseEnv(raw);
    } catch (err) {
      logger.warn({
        event: 'seed.secrets_read_failed',
        path,
        error: (err as Error).message,
      });
    }
  }
  return {};
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Tira aspas circundantes simples ou duplas
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
