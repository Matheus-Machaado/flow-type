/**
 * Conexão SQLite via better-sqlite3 (sync, per ADR-03).
 *
 * Aplica pragmas obrigatórios:
 *   journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON,
 *   temp_store=MEMORY, busy_timeout=5000.
 *
 * Path default: <userData>/flowtype/db.sqlite (Electron). Pode ser sobrescrito
 * via FLOWTYPE_DB_PATH (testes) ou FLOWTYPE_DATA_DIR (testes/CLI).
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { logger } from '../utils/logger.js';

export type DB = Database.Database;

export function getDefaultDbPath(): string {
  if (process.env.FLOWTYPE_DB_PATH) return process.env.FLOWTYPE_DB_PATH;
  if (process.env.FLOWTYPE_DATA_DIR) {
    return join(process.env.FLOWTYPE_DATA_DIR, 'db.sqlite');
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return join(app.getPath('userData'), 'db.sqlite');
    }
  } catch {
    // electron não disponível
  }
  return join(os.tmpdir(), 'flowtype', 'db.sqlite');
}

export interface OpenDatabaseOptions {
  path?: string;
  readonly?: boolean;
  verbose?: boolean;
}

/**
 * Abre (ou cria) o DB SQLite no path fornecido e aplica os pragmas
 * obrigatórios. Retorna a instância — chamador é dono do .close().
 */
export function openDatabase(opts: OpenDatabaseOptions = {}): DB {
  const dbPath = opts.path ?? getDefaultDbPath();

  // Cria diretório do DB se ainda não existir
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath, {
    readonly: opts.readonly ?? false,
    verbose: opts.verbose ? (msg) => logger.debug({ event: 'db.sql', sql: msg }) : undefined,
  });

  applyPragmas(db);

  logger.info({ event: 'db.opened', path: dbPath });
  return db;
}

/**
 * Aplica os pragmas obrigatórios. Idempotente — pode ser chamada várias vezes.
 */
export function applyPragmas(db: DB): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  db.pragma('busy_timeout = 5000');
}
