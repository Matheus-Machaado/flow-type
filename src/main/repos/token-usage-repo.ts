/**
 * TokenUsageRepo
 *
 * Consumo diário por slot Groq. Cobre e6-schema-token-usage + CR-1.
 * UPSERT em (provider, slot_index, day) evita race no primeiro request do dia.
 */

import type { DB } from '../db/connection.js';
import type { TokenUsage } from '../../shared/db-types.js';
import { newId } from '../utils/ulid.js';

interface TokenUsageRow {
  id: string;
  provider: string;
  slot_index: number;
  slot_label: string | null;
  day: string;
  requests_count: number;
  last_used_at: string | null;
  marked_exhausted_at: string | null;
  marked_invalid_at: string | null;
  created_at: string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export class TokenUsageRepo {
  constructor(private readonly db: DB) {}

  /**
   * Incrementa contador (cria row se primeira do dia).
   * Retorna o registro atualizado.
   */
  increment(
    provider: string,
    slotIndex: number,
    label?: string | null,
    count = 1,
    day: string = todayUtc(),
  ): TokenUsage {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO token_usage (
           id, provider, slot_index, slot_label, day,
           requests_count, last_used_at
         ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(provider, slot_index, day) DO UPDATE SET
           requests_count = requests_count + excluded.requests_count,
           last_used_at = excluded.last_used_at,
           slot_label = COALESCE(excluded.slot_label, token_usage.slot_label)`,
      )
      .run(id, provider, slotIndex, label ?? null, day, count);
    return this.getRow(provider, slotIndex, day)!;
  }

  /** Lista as rows do dia (1 por slot ativo). */
  snapshot(provider: string, day: string = todayUtc()): TokenUsage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM token_usage WHERE provider = ? AND day = ?
         ORDER BY slot_index ASC`,
      )
      .all(provider, day) as TokenUsageRow[];
    return rows.map(this.rowToEntity);
  }

  /** Marca exhausted (cap/429). Cria row se ainda não existe pra hoje. */
  markExhausted(
    provider: string,
    slotIndex: number,
    day: string = todayUtc(),
  ): void {
    this.ensureRow(provider, slotIndex, day);
    this.db
      .prepare(
        `UPDATE token_usage
            SET marked_exhausted_at = datetime('now')
          WHERE provider = ? AND slot_index = ? AND day = ?`,
      )
      .run(provider, slotIndex, day);
  }

  /**
   * Marca invalid (401). Persiste cross-day — replica em todas as rows futuras
   * via consulta da última known invalid quando GroqKeyPool bootstrar.
   * Por simplicidade, gravamos só na row do dia + uma "lápide" sem dia (não usada v0.1).
   */
  markInvalid(provider: string, slotIndex: number, day: string = todayUtc()): void {
    this.ensureRow(provider, slotIndex, day);
    this.db
      .prepare(
        `UPDATE token_usage
            SET marked_invalid_at = datetime('now')
          WHERE provider = ? AND slot_index = ? AND day = ?`,
      )
      .run(provider, slotIndex, day);
  }

  /**
   * Reset diário: limpa `marked_exhausted_at` em rows do dia (mantém invalid).
   * Roda em cron 00:00 UTC + at app boot se lastReset > 24h.
   * Retorna número de slots resetados.
   */
  resetDaily(day: string = todayUtc()): number {
    const info = this.db
      .prepare(
        `UPDATE token_usage
            SET marked_exhausted_at = NULL
          WHERE day = ? AND marked_exhausted_at IS NOT NULL`,
      )
      .run(day);
    return info.changes;
  }

  /**
   * Zera requests_count das rows do dia corrente (mantém marked_invalid_at).
   * Usado em conjunto com resetDaily() pra simular novo dia em testes/manual reset.
   */
  resetCounters(provider: string, day: string = todayUtc()): number {
    const info = this.db
      .prepare(
        `UPDATE token_usage
            SET requests_count = 0
          WHERE provider = ? AND day = ?`,
      )
      .run(provider, day);
    return info.changes;
  }

  /** Remove rows mais antigas que `days` (job mensal). */
  cleanup(days = 90): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const info = this.db.prepare('DELETE FROM token_usage WHERE day < ?').run(cutoff);
    return info.changes;
  }

  /** Helper: retorna a row se existir, sem hidratar. */
  private getRow(provider: string, slotIndex: number, day: string): TokenUsage | null {
    const row = this.db
      .prepare(
        `SELECT * FROM token_usage WHERE provider = ? AND slot_index = ? AND day = ?`,
      )
      .get(provider, slotIndex, day) as TokenUsageRow | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  /** Garante que a row do dia exista (sem incrementar contador). */
  private ensureRow(provider: string, slotIndex: number, day: string): void {
    this.db
      .prepare(
        `INSERT INTO token_usage (id, provider, slot_index, day, requests_count)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(provider, slot_index, day) DO NOTHING`,
      )
      .run(newId(), provider, slotIndex, day);
  }

  private rowToEntity = (row: TokenUsageRow): TokenUsage => ({
    id: row.id,
    provider: row.provider,
    slot_index: row.slot_index,
    slot_label: row.slot_label,
    day: row.day,
    requests_count: row.requests_count,
    last_used_at: row.last_used_at,
    marked_exhausted_at: row.marked_exhausted_at,
    marked_invalid_at: row.marked_invalid_at,
    created_at: row.created_at,
  });
}
