/**
 * Runner de migrations versionadas.
 *
 * Cobre e6-migrations-versioned:
 *   - Cria tabela `_migrations` se não existir
 *   - Lê pasta de migrations, ordena por nome, aplica não-aplicadas
 *   - Cada arquivo .sql carrega seu próprio BEGIN/COMMIT
 *   - Falha → log estruturado + throw (boot do app aborta)
 *   - Idempotente: rodar 2x não falha
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './connection.js';
import { logger } from '../utils/logger.js';

/**
 * Localiza o diretório de migrations. Estratégia:
 *   1. `process.env.FLOWTYPE_MIGRATIONS_DIR` (override).
 *   2. Pasta `migrations/` ao lado do arquivo (dev TS via vitest, prod CJS bundled).
 *   3. Fallback: caminha pra `src/main/db/migrations` (dev sem bundle).
 */
export function defaultMigrationsDir(): string {
  if (process.env.FLOWTYPE_MIGRATIONS_DIR) return process.env.FLOWTYPE_MIGRATIONS_DIR;

  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    // Em CJS bundled, import.meta.url pode lançar — usa __dirname.
    here =
      typeof __dirname === 'string' ? __dirname : process.cwd();
  }

  const sibling = join(here, 'migrations');
  if (existsSync(sibling)) return sibling;

  // Fallback: src/main/db/migrations relativo ao cwd
  return join(process.cwd(), 'src', 'main', 'db', 'migrations');
}

export interface RunMigrationsOptions {
  migrationsDir?: string;
}

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

/**
 * Aplica todas migrations pendentes em ordem alfabética.
 * Retorna lista dos nomes aplicados nesta execução.
 */
export function runMigrations(db: DB, opts: RunMigrationsOptions = {}): string[] {
  const dir = opts.migrationsDir ?? defaultMigrationsDir();

  ensureMigrationsTable(db);

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    logger.error({ event: 'migrate.dir_read_failed', dir, err: (err as Error).message });
    throw err;
  }

  const newlyApplied: string[] = [];
  const insertStmt = db.prepare(
    "INSERT INTO _migrations (name, applied_at) VALUES (?, datetime('now'))",
  );

  for (const file of files) {
    const name = file.replace(/\.sql$/, '');
    if (applied.has(name)) {
      logger.debug({ event: 'migrate.skip', name });
      continue;
    }
    const sqlPath = join(dir, file);
    const sql = readFileSync(sqlPath, 'utf-8');

    try {
      // Cada arquivo carrega BEGIN/COMMIT próprio — db.exec processa multi-statement.
      db.exec(sql);
      insertStmt.run(name);
      newlyApplied.push(name);
      logger.info({ event: 'migrate.applied', name });
    } catch (err) {
      // Tenta rollback explícito (se BEGIN sem COMMIT ficou aberto).
      try {
        db.exec('ROLLBACK');
      } catch {
        /* sem tx ativa — ignore */
      }
      const message = (err as Error).message;
      logger.error({ event: 'migrate.failed', name, error: message });
      throw new Error(`Migration ${name} failed: ${message}`);
    }
  }

  return newlyApplied;
}

function ensureMigrationsTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function listApplied(db: DB): MigrationRecord[] {
  ensureMigrationsTable(db);
  return db
    .prepare('SELECT id, name, applied_at FROM _migrations ORDER BY id ASC')
    .all() as MigrationRecord[];
}
