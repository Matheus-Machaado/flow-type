/**
 * VocabRepo
 *
 * Persiste correções pós-transcrição. Cobre e4-vocab-custom-list, e6-schema-vocab.
 */

import type { DB } from '../db/connection.js';
import type { VocabEntry, VocabEntryInput, VocabEntryUpdate } from '../../shared/db-types.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { newId } from '../utils/ulid.js';

interface VocabRow {
  id: string;
  term_wrong: string;
  term_correct: string;
  case_sensitive: number;
  scope: string;
  times_applied: number;
  created_at: string;
  updated_at: string;
}

export class VocabRepo {
  constructor(private readonly db: DB) {}

  list(): VocabEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM vocab_entry ORDER BY updated_at DESC')
      .all() as VocabRow[];
    return rows.map(this.rowToEntity);
  }

  /** Lista entries aplicáveis a um exe específico: global + scope=exeName. */
  getByScope(exe?: string): VocabEntry[] {
    if (!exe) {
      const rows = this.db
        .prepare(`SELECT * FROM vocab_entry WHERE scope = 'global' ORDER BY updated_at DESC`)
        .all() as VocabRow[];
      return rows.map(this.rowToEntity);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM vocab_entry
         WHERE scope = 'global' OR scope = ?
         ORDER BY scope = 'global' ASC, updated_at DESC`,
      )
      .all(exe.toLowerCase()) as VocabRow[];
    return rows.map(this.rowToEntity);
  }

  getById(id: string): VocabEntry {
    const row = this.db.prepare('SELECT * FROM vocab_entry WHERE id = ?').get(id) as
      | VocabRow
      | undefined;
    if (!row) throw new NotFoundError(`vocab_entry ${id} not found`);
    return this.rowToEntity(row);
  }

  add(input: VocabEntryInput): VocabEntry {
    if (!input.term_wrong || !input.term_correct) {
      throw new ValidationError('term_wrong and term_correct are required');
    }
    const id = input.id ?? newId();
    this.db
      .prepare(
        `INSERT INTO vocab_entry (id, term_wrong, term_correct, case_sensitive, scope)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.term_wrong,
        input.term_correct,
        input.case_sensitive ? 1 : 0,
        (input.scope ?? 'global').toLowerCase(),
      );
    return this.getById(id);
  }

  update(id: string, patch: VocabEntryUpdate): VocabEntry {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.term_wrong !== undefined) {
      if (!patch.term_wrong) throw new ValidationError('term_wrong must be non-empty');
      sets.push('term_wrong = ?');
      params.push(patch.term_wrong);
    }
    if (patch.term_correct !== undefined) {
      if (!patch.term_correct) throw new ValidationError('term_correct must be non-empty');
      sets.push('term_correct = ?');
      params.push(patch.term_correct);
    }
    if (patch.case_sensitive !== undefined) {
      sets.push('case_sensitive = ?');
      params.push(patch.case_sensitive ? 1 : 0);
    }
    if (patch.scope !== undefined) {
      sets.push('scope = ?');
      params.push(patch.scope.toLowerCase());
    }
    if (sets.length === 0) return this.getById(id);
    sets.push("updated_at = datetime('now')");

    const info = this.db
      .prepare(`UPDATE vocab_entry SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params, id);
    if (info.changes === 0) throw new NotFoundError(`vocab_entry ${id} not found`);
    return this.getById(id);
  }

  remove(id: string): void {
    const info = this.db.prepare('DELETE FROM vocab_entry WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundError(`vocab_entry ${id} not found`);
  }

  /** Incrementa o contador de uso de uma entry (chamado pelo pipeline de aplicação). */
  incrementTimesApplied(id: string, by = 1): void {
    this.db
      .prepare(
        `UPDATE vocab_entry SET times_applied = times_applied + ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(by, id);
  }

  private rowToEntity = (row: VocabRow): VocabEntry => ({
    id: row.id,
    term_wrong: row.term_wrong,
    term_correct: row.term_correct,
    case_sensitive: row.case_sensitive === 1,
    scope: row.scope,
    times_applied: row.times_applied,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}
