/**
 * GroqSlotMetaRepo
 *
 * Metadados por slot Groq (3 rows fixas 0/1/2). Cobre e6-schema-groq-slot-meta + CR-1.
 * Bootstrap em migrations já cria as 3 rows vazias; aqui só UPSERTamos campos.
 */

import type { DB } from '../db/connection.js';
import type {
  GroqSlotMeta,
  GroqSlotMetaUpsert,
  GroqValidationStatus,
} from '../../shared/db-types.js';
import { NotFoundError } from '../../shared/errors.js';

interface GroqSlotMetaRow {
  slot_index: number;
  api_key_encrypted: string | null;
  label: string | null;
  daily_cap: number;
  added_at: string | null;
  last_validated_at: string | null;
  validation_status: string;
}

export class GroqSlotMetaRepo {
  constructor(private readonly db: DB) {}

  list(): GroqSlotMeta[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM groq_slot_meta ORDER BY slot_index ASC`,
      )
      .all() as GroqSlotMetaRow[];
    return rows.map(this.rowToEntity);
  }

  get(slotIndex: 0 | 1 | 2): GroqSlotMeta {
    const row = this.db
      .prepare(`SELECT * FROM groq_slot_meta WHERE slot_index = ?`)
      .get(slotIndex) as GroqSlotMetaRow | undefined;
    if (!row) throw new NotFoundError(`groq_slot_meta ${slotIndex} not found`);
    return this.rowToEntity(row);
  }

  /**
   * Update parcial dos campos do slot. Slot já existe (seed da migration).
   * Se `api_key_encrypted` for fornecido != null, `added_at` é atualizado pra now.
   */
  upsert(slotIndex: 0 | 1 | 2, data: GroqSlotMetaUpsert): GroqSlotMeta {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.api_key_encrypted !== undefined) {
      sets.push('api_key_encrypted = ?');
      params.push(data.api_key_encrypted);
      // Quando recebe key nova, marca added_at
      if (data.api_key_encrypted) {
        sets.push("added_at = datetime('now')");
      } else {
        sets.push('added_at = NULL');
      }
    }
    if (data.label !== undefined) {
      sets.push('label = ?');
      params.push(data.label);
    }
    if (data.daily_cap !== undefined) {
      if (data.daily_cap <= 0) {
        throw new Error('daily_cap must be > 0');
      }
      sets.push('daily_cap = ?');
      params.push(data.daily_cap);
    }
    if (data.validation_status !== undefined) {
      sets.push('validation_status = ?');
      params.push(data.validation_status);
      sets.push("last_validated_at = datetime('now')");
    }

    if (sets.length === 0) return this.get(slotIndex);

    const info = this.db
      .prepare(`UPDATE groq_slot_meta SET ${sets.join(', ')} WHERE slot_index = ?`)
      .run(...params, slotIndex);
    if (info.changes === 0) {
      throw new NotFoundError(`groq_slot_meta ${slotIndex} not found`);
    }
    return this.get(slotIndex);
  }

  /** Atualiza só o status de validação (chamado pelo validateGroqKey). */
  markValidationStatus(slotIndex: 0 | 1 | 2, status: GroqValidationStatus): GroqSlotMeta {
    return this.upsert(slotIndex, { validation_status: status });
  }

  /** Limpa o slot (remove key). Equivale a `upsert(idx, { api_key_encrypted: null, label: null })`. */
  clear(slotIndex: 0 | 1 | 2): GroqSlotMeta {
    return this.upsert(slotIndex, {
      api_key_encrypted: null,
      label: null,
      validation_status: 'untested',
    });
  }

  private rowToEntity = (row: GroqSlotMetaRow): GroqSlotMeta => ({
    slot_index: row.slot_index as 0 | 1 | 2,
    api_key_encrypted: row.api_key_encrypted,
    label: row.label,
    daily_cap: row.daily_cap,
    added_at: row.added_at,
    last_validated_at: row.last_validated_at,
    validation_status: row.validation_status as GroqValidationStatus,
  });
}
