/**
 * SettingsRepo
 *
 * Key-value JSON. Cache in-memory invalidado em qualquer setSetting.
 * Cobre e6-schema-settings.
 */

import type { DB } from '../db/connection.js';
import { SETTINGS_DEFAULTS } from '../../shared/db-types.js';

interface SettingsRowDb {
  key: string;
  value: string;
  updated_at: string;
}

export class SettingsRepo {
  private cache = new Map<string, unknown>();
  private cacheLoaded = false;

  constructor(private readonly db: DB) {}

  /**
   * Recupera valor parseado. Se `fallback` for fornecido, retorna ele quando ausente.
   * Caso contrário, consulta `SETTINGS_DEFAULTS` e por último retorna undefined.
   */
  get<T = unknown>(key: string, fallback?: T): T {
    this.ensureCache();
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }
    if (fallback !== undefined) return fallback;
    if (key in SETTINGS_DEFAULTS) return SETTINGS_DEFAULTS[key] as T;
    return undefined as unknown as T;
  }

  set<T = unknown>(key: string, value: T): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value));
    this.cache.set(key, value);
  }

  /** Apaga uma key (volta ao default). */
  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    this.cache.delete(key);
  }

  /**
   * Reseta: se key fornecida, apaga ela. Se omitida, apaga TUDO e repopula defaults.
   * NUNCA zera o banco em rotina (ver lesson `never_wipe_db_routine`); use só quando
   * o user pede explicitamente em Settings → "Restaurar padrões".
   */
  reset(key?: string): void {
    if (key) {
      this.delete(key);
      return;
    }
    this.db.exec('DELETE FROM settings');
    this.cache.clear();
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
    );
    const tx = this.db.transaction(() => {
      for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) {
        stmt.run(k, JSON.stringify(v));
      }
    });
    tx();
    this.cacheLoaded = false;
  }

  /** Retorna snapshot de todas as settings com defaults aplicados. */
  getAll(): Record<string, unknown> {
    this.ensureCache();
    const out: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
    for (const [k, v] of this.cache.entries()) {
      out[k] = v;
    }
    return out;
  }

  /** Invalida cache (testes / fontes externas). */
  invalidate(): void {
    this.cache.clear();
    this.cacheLoaded = false;
  }

  private ensureCache(): void {
    if (this.cacheLoaded) return;
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Pick<
      SettingsRowDb,
      'key' | 'value'
    >[];
    for (const row of rows) {
      try {
        this.cache.set(row.key, JSON.parse(row.value));
      } catch {
        this.cache.set(row.key, row.value);
      }
    }
    this.cacheLoaded = true;
  }
}
