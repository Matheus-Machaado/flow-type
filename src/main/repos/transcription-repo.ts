/**
 * TranscriptionRepo
 *
 * Wrapper tipado sobre better-sqlite3 pra tabela `transcription` + busca FTS5.
 * Cobre features e6-schema-transcription, e6-fts5-search, e4-history-*.
 */

import type { DB } from '../db/connection.js';
import type {
  Transcription,
  TranscriptionInsertInput,
  TranscriptionListFilters,
  TranscriptionSearchOptions,
  VocabCorrectionApplied,
} from '../../shared/db-types.js';
import { NotFoundError } from '../../shared/errors.js';
import { newId } from '../utils/ulid.js';

interface TranscriptionRow {
  id: string;
  ts: string;
  text: string;
  audio_path: string | null;
  app_exe: string | null;
  app_window_title: string | null;
  app_field_type: string | null;
  provider_used: string;
  slot_index: number | null;
  slot_label: string | null;
  latency_ms: number;
  duration_ms: number;
  language: string | null;
  vocab_corrections_applied: string;
  paste_method: string;
  paste_succeeded: number;
  target_window_lost_focus: number;
  created_at: string;
}

export class TranscriptionRepo {
  constructor(private readonly db: DB) {}

  /** Insere nova transcrição. Retorna a entidade já hidratada. */
  insert(input: TranscriptionInsertInput): Transcription {
    const id = input.id ?? newId();
    const ts = input.ts ?? new Date().toISOString();
    const corrections = JSON.stringify(input.vocab_corrections_applied ?? []);

    this.db
      .prepare(
        `INSERT INTO transcription (
           id, ts, text, audio_path, app_exe, app_window_title, app_field_type,
           provider_used, slot_index, slot_label, latency_ms, duration_ms,
           language, vocab_corrections_applied, paste_method, paste_succeeded,
           target_window_lost_focus
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        ts,
        input.text,
        input.audio_path ?? null,
        input.app_exe ?? null,
        input.app_window_title ?? null,
        input.app_field_type ?? null,
        input.provider_used,
        input.slot_index ?? null,
        input.slot_label ?? null,
        input.latency_ms ?? 0,
        input.duration_ms ?? 0,
        input.language ?? null,
        corrections,
        input.paste_method ?? 'clipboard',
        (input.paste_succeeded ?? true) ? 1 : 0,
        (input.target_window_lost_focus ?? false) ? 1 : 0,
      );

    return this.getById(id);
  }

  /** Lista cronológica reversa com paginação. */
  listRecent(limit = 50, offset = 0): Transcription[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM transcription
         ORDER BY ts DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as TranscriptionRow[];
    return rows.map(this.rowToEntity);
  }

  /**
   * Busca via FTS5. Query usa MATCH; filtros adicionais via WHERE.
   * Retorna ordenado por rank (bm25 ASC = mais relevante).
   */
  search(query: string, opts: TranscriptionSearchOptions = {}): Transcription[] {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const filters = opts.filters ?? {};

    const whereParts: string[] = ['transcription_fts MATCH ?'];
    const params: unknown[] = [query];

    if (filters.dateFrom) {
      whereParts.push('t.ts >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      whereParts.push('t.ts <= ?');
      params.push(filters.dateTo);
    }
    if (filters.appExe && filters.appExe.length > 0) {
      const placeholders = filters.appExe.map(() => '?').join(', ');
      whereParts.push(`t.app_exe IN (${placeholders})`);
      params.push(...filters.appExe);
    }
    if (filters.provider) {
      whereParts.push('t.provider_used = ?');
      params.push(filters.provider);
    }

    const sql = `
      SELECT t.*
      FROM transcription_fts
      JOIN transcription t ON t.rowid = transcription_fts.rowid
      WHERE ${whereParts.join(' AND ')}
      ORDER BY bm25(transcription_fts) ASC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as TranscriptionRow[];
    return rows.map(this.rowToEntity);
  }

  /** Lista filtrada (sem busca textual) por filtros e paginação. */
  list(filters: TranscriptionListFilters = {}, limit = 50, offset = 0): Transcription[] {
    const whereParts: string[] = [];
    const params: unknown[] = [];

    if (filters.dateFrom) {
      whereParts.push('ts >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      whereParts.push('ts <= ?');
      params.push(filters.dateTo);
    }
    if (filters.appExe && filters.appExe.length > 0) {
      const placeholders = filters.appExe.map(() => '?').join(', ');
      whereParts.push(`app_exe IN (${placeholders})`);
      params.push(...filters.appExe);
    }
    if (filters.provider) {
      whereParts.push('provider_used = ?');
      params.push(filters.provider);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM transcription ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as TranscriptionRow[];
    return rows.map(this.rowToEntity);
  }

  /** Busca por id. Throws NotFoundError se não existir. */
  getById(id: string): Transcription {
    const row = this.db.prepare('SELECT * FROM transcription WHERE id = ?').get(id) as
      | TranscriptionRow
      | undefined;
    if (!row) throw new NotFoundError(`transcription ${id} not found`);
    return this.rowToEntity(row);
  }

  /** Variante opcional pra UI: não lança. */
  findById(id: string): Transcription | null {
    const row = this.db.prepare('SELECT * FROM transcription WHERE id = ?').get(id) as
      | TranscriptionRow
      | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  /** Atualiza só o campo `text` (cobre e4-history-window-timeline edit). */
  updateText(id: string, text: string): Transcription {
    const info = this.db
      .prepare('UPDATE transcription SET text = ? WHERE id = ?')
      .run(text, id);
    if (info.changes === 0) throw new NotFoundError(`transcription ${id} not found`);
    return this.getById(id);
  }

  /** Deleta uma transcrição (FTS sincroniza via trigger). */
  delete(id: string): void {
    const info = this.db.prepare('DELETE FROM transcription WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundError(`transcription ${id} not found`);
  }

  /**
   * Deleta linhas com `created_at` mais antigas que `days` dias.
   * Retorna número de rows removidas.
   */
  deleteOlderThan(days: number): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const info = this.db
      .prepare('DELETE FROM transcription WHERE created_at < ?')
      .run(cutoff);
    return info.changes;
  }

  /** Conta total de linhas (para paginação UI). */
  count(filters: TranscriptionListFilters = {}): number {
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (filters.dateFrom) {
      whereParts.push('ts >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      whereParts.push('ts <= ?');
      params.push(filters.dateTo);
    }
    if (filters.appExe && filters.appExe.length > 0) {
      const placeholders = filters.appExe.map(() => '?').join(', ');
      whereParts.push(`app_exe IN (${placeholders})`);
      params.push(...filters.appExe);
    }
    if (filters.provider) {
      whereParts.push('provider_used = ?');
      params.push(filters.provider);
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM transcription ${where}`)
      .get(...params) as { n: number };
    return row.n;
  }

  private rowToEntity = (row: TranscriptionRow): Transcription => {
    let corrections: VocabCorrectionApplied[] = [];
    try {
      const parsed = JSON.parse(row.vocab_corrections_applied);
      if (Array.isArray(parsed)) corrections = parsed;
    } catch {
      corrections = [];
    }
    return {
      id: row.id,
      ts: row.ts,
      text: row.text,
      audio_path: row.audio_path,
      app_exe: row.app_exe,
      app_window_title: row.app_window_title,
      app_field_type: row.app_field_type,
      provider_used: row.provider_used as Transcription['provider_used'],
      slot_index: row.slot_index,
      slot_label: row.slot_label,
      latency_ms: row.latency_ms,
      duration_ms: row.duration_ms,
      language: row.language,
      vocab_corrections_applied: corrections,
      paste_method: row.paste_method as Transcription['paste_method'],
      paste_succeeded: row.paste_succeeded === 1,
      target_window_lost_focus: row.target_window_lost_focus === 1,
      created_at: row.created_at,
    };
  };
}
