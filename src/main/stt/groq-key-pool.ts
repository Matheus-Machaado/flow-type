/**
 * GroqKeyPool — primitiva multi-slot com estado por key (CR-1 + e2-groq-key-pool).
 *
 * Wraps GroqSlotMetaRepo (meta persistente: key, label, daily_cap, validation_status)
 * + TokenUsageRepo (consumo diário, exhausted/invalid flags). Mantém um ponteiro
 * round-robin in-memory pra distribuição uniforme entre slots `online`.
 *
 * Estados derivados:
 *   - `online`     → validation_status='online' && !exhausted && !invalid && usedToday<dailyCap
 *   - `invalid`    → validation_status='invalid' || marked_invalid_at presente hoje
 *   - `exhausted`  → marked_exhausted_at presente hoje || usedToday >= dailyCap
 *
 * Persistência: tudo via repos (resiliente a restart). Round-robin pointer é
 * só in-memory (não persistido; tolerável porque distribuição uniforme em
 * janelas curtas não depende de cross-restart).
 */

import type { GroqSlotMetaRepo } from '../repos/groq-slot-meta-repo.js';
import type { TokenUsageRepo } from '../repos/token-usage-repo.js';
import type { GroqSlotMeta, TokenUsage } from '../../shared/db-types.js';
import { logger } from '../utils/logger.js';
import {
  type GroqSlotStatus,
  type NextSlot,
  type PoolSnapshot,
  type SlotSnapshot,
  PoolEmptyError,
  maskGroqKey,
} from './stt-types.js';

const PROVIDER = 'groq';
const TOTAL_SLOTS = 3 as const;

export interface GroqKeyPoolOptions {
  /** Injeção de relógio pra testes. Default `() => new Date()`. */
  now?: () => Date;
}

export interface SetSlotInput {
  apiKey: string;
  label?: string | null;
  dailyCap?: number;
  /** Opcional — quando vem de validate(): marca validation_status='online'. */
  validationOk?: boolean;
}

export class GroqKeyPool {
  private nextSlotIndex = 0;
  private readonly now: () => Date;

  constructor(
    private readonly slotsRepo: GroqSlotMetaRepo,
    private readonly tokenUsageRepo: TokenUsageRepo,
    opts: GroqKeyPoolOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    // Inicializa ponteiro no primeiro slot online (se algum). Idempotente.
    const snap = this.snapshot();
    const firstOnline = snap.slots.find((s) => s.status === 'online');
    this.nextSlotIndex = firstOnline ? firstOnline.slotIndex : 0;
  }

  // ─── Read API ─────────────────────────────────────────────────────

  snapshot(): PoolSnapshot {
    const today = this.today();
    const metas = this.slotsRepo.list();
    const usages = this.tokenUsageRepo.snapshot(PROVIDER, today);
    const usageByIdx = new Map<number, TokenUsage>(
      usages.map((u) => [u.slot_index, u]),
    );

    const slots: SlotSnapshot[] = metas.map((m) => this.buildSnapshot(m, usageByIdx.get(m.slot_index) ?? null));
    const online = slots.filter((s) => s.status === 'online').length;
    const invalid = slots.filter((s) => s.status === 'invalid').length;
    const exhausted = slots.filter((s) => s.status === 'exhausted').length;
    const totalUsedToday = slots.reduce((sum, s) => sum + s.usedToday, 0);

    return {
      totalSlots: TOTAL_SLOTS,
      online,
      invalid,
      exhausted,
      totalUsedToday,
      slots,
    };
  }

  onlineCount(): number {
    return this.snapshot().online;
  }

  allUnavailable(): boolean {
    return this.onlineCount() === 0;
  }

  /**
   * Retorna o próximo slot online via round-robin. Persistente quando ao boot
   * (escolhe o primeiro online). Throws PoolEmptyError se nenhum disponível.
   */
  next(): NextSlot {
    const snap = this.snapshot();
    const onlineSlots = snap.slots.filter((s) => s.status === 'online');
    if (onlineSlots.length === 0) {
      throw new PoolEmptyError('GroqKeyPool: nenhum slot disponível');
    }

    // Avança o ponteiro até achar próximo online (incluindo `nextSlotIndex` em si).
    for (let step = 0; step < TOTAL_SLOTS; step++) {
      const candidateIdx = ((this.nextSlotIndex + step) % TOTAL_SLOTS) as 0 | 1 | 2;
      const slot = snap.slots[candidateIdx];
      if (slot.status !== 'online') continue;
      // Encontrou. Avança o ponteiro pra próxima chamada.
      this.nextSlotIndex = (candidateIdx + 1) % TOTAL_SLOTS;
      const meta = this.slotsRepo.get(candidateIdx);
      if (!meta.api_key_encrypted) {
        // edge: meta marcou online mas key apagada — defensivo.
        throw new PoolEmptyError(`GroqKeyPool: slot ${candidateIdx} online mas sem key`);
      }
      return {
        apiKey: meta.api_key_encrypted,
        slotIndex: candidateIdx,
        label: meta.label ?? undefined,
      };
    }

    // Defensivo (não deve ser alcançado se onlineSlots.length > 0).
    throw new PoolEmptyError('GroqKeyPool: ponteiro não encontrou slot online');
  }

  // ─── Write API ────────────────────────────────────────────────────

  /**
   * Marca slot como exhausted (429 ou daily_cap atingido). Persiste em
   * token_usage.marked_exhausted_at. Não toca validation_status do slot meta
   * (slot continua "online" — apenas a row do dia indica esgotamento).
   */
  markExhausted(slotIndex: 0 | 1 | 2): void {
    this.tokenUsageRepo.markExhausted(PROVIDER, slotIndex, this.today());
    logger.info({
      event: 'groq.pool.marked_exhausted',
      slot: slotIndex,
      day: this.today(),
    });
  }

  /**
   * Marca slot como invalid (401). Persiste em DOIS lugares:
   *  - groq_slot_meta.validation_status='invalid' (cross-day, exige re-validate)
   *  - token_usage.marked_invalid_at (no row do dia, pra UI e telemetria)
   */
  markInvalid(slotIndex: 0 | 1 | 2): void {
    this.slotsRepo.markValidationStatus(slotIndex, 'invalid');
    this.tokenUsageRepo.markInvalid(PROVIDER, slotIndex, this.today());
    logger.warn({
      event: 'groq.pool.marked_invalid',
      slot: slotIndex,
    });
  }

  /**
   * Incrementa contador de uso. Auto-marca exhausted ao atingir daily_cap.
   * Retorna o novo `usedToday`.
   */
  incrementUsage(slotIndex: 0 | 1 | 2, count = 1): number {
    const meta = this.slotsRepo.get(slotIndex);
    const label = meta.label ?? null;
    const row = this.tokenUsageRepo.increment(PROVIDER, slotIndex, label, count, this.today());
    if (row.requests_count >= meta.daily_cap) {
      this.markExhausted(slotIndex);
    }
    return row.requests_count;
  }

  /**
   * Reset diário: zera usedToday + limpa marked_exhausted_at (mantém invalid).
   * Re-aponta ponteiro round-robin pra primeiro online após reset.
   *
   * Em produção isso roda em cron 00:00 UTC + boot-check (lastReset > 24h).
   * Como `day` é PK natural, o dia seguinte cria rows novas com count=0;
   * `resetDaily()` modela a operação semântica de "novo dia começa" zerando
   * a row do dia corrente — útil pra forçar reset manual em Settings (futuro)
   * e simulação em testes.
   */
  resetDaily(): number {
    const today = this.today();
    const cleared = this.tokenUsageRepo.resetDaily(today);
    this.tokenUsageRepo.resetCounters('groq', today);

    // Re-aponta o ponteiro pra primeiro online (caso ele estivesse em slot exhausted).
    const snap = this.snapshot();
    const firstOnline = snap.slots.find((s) => s.status === 'online');
    if (firstOnline) this.nextSlotIndex = firstOnline.slotIndex;
    logger.info({ event: 'groq.pool.reset_daily', cleared });
    return cleared;
  }

  /**
   * Adiciona/substitui slot (chamado por Settings/Onboarding após validateGroqKey).
   * NÃO valida — chamador é responsável por validar antes.
   */
  setSlot(slotIndex: 0 | 1 | 2, input: SetSlotInput): GroqSlotMeta {
    const meta = this.slotsRepo.upsert(slotIndex, {
      api_key_encrypted: input.apiKey,
      label: input.label ?? null,
      daily_cap: input.dailyCap,
      validation_status: input.validationOk ? 'online' : undefined,
    });
    logger.info({
      event: 'groq.pool.slot_set',
      slot: slotIndex,
      key_masked: maskGroqKey(input.apiKey),
      label: input.label ?? null,
    });
    return meta;
  }

  /** Marca slot como online (após re-validate bem-sucedida). */
  markOnline(slotIndex: 0 | 1 | 2): void {
    this.slotsRepo.markValidationStatus(slotIndex, 'online');
    logger.info({ event: 'groq.pool.marked_online', slot: slotIndex });
  }

  /** Marca slot como untested (sem testar agora). */
  markUntested(slotIndex: 0 | 1 | 2): void {
    this.slotsRepo.markValidationStatus(slotIndex, 'untested');
  }

  /**
   * Retorna a api key bruta de um slot (lookup direto no repo).
   * NÃO consome o ponteiro round-robin. Usado por IPC `stt:test-slot` e por
   * fluxos que precisam re-validar uma key específica.
   */
  getSlotApiKey(slotIndex: 0 | 1 | 2): string | null {
    const meta = this.slotsRepo.get(slotIndex);
    return meta.api_key_encrypted ?? null;
  }

  /** Remove o slot (limpa key e label, status='untested'). */
  clearSlot(slotIndex: 0 | 1 | 2): void {
    this.slotsRepo.clear(slotIndex);
    logger.info({ event: 'groq.pool.slot_cleared', slot: slotIndex });
  }

  // ─── Internals ────────────────────────────────────────────────────

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private buildSnapshot(meta: GroqSlotMeta, usage: TokenUsage | null): SlotSnapshot {
    const hasKey = !!meta.api_key_encrypted;
    const usedToday = usage?.requests_count ?? 0;
    const dailyCap = meta.daily_cap;
    const pctUsed = dailyCap > 0 ? Math.min(100, Math.round((usedToday / dailyCap) * 100)) : 0;

    const isInvalid =
      meta.validation_status === 'invalid' || !!usage?.marked_invalid_at;
    const isExhausted =
      !!usage?.marked_exhausted_at || (dailyCap > 0 && usedToday >= dailyCap);

    // Decisão de status pro pool (online = elegível pra next()):
    //  - sem key                                  → invalid (sentinel)
    //  - validation_status='untested' com key     → invalid (UI deve testar antes de usar)
    //  - invalid (status ou flag do dia)          → invalid
    //  - exhausted (cap atingido ou flag do dia)  → exhausted
    //  - resto                                    → online
    let status: GroqSlotStatus;
    if (!hasKey) {
      status = 'invalid';
    } else if (isInvalid) {
      status = 'invalid';
    } else if (meta.validation_status === 'untested') {
      status = 'invalid';
    } else if (isExhausted) {
      status = 'exhausted';
    } else {
      status = 'online';
    }

    return {
      slotIndex: meta.slot_index,
      hasKey,
      label: meta.label ?? undefined,
      status,
      validationStatus: meta.validation_status,
      usedToday,
      dailyCap,
      pctUsed,
      lastValidatedAt: meta.last_validated_at ?? undefined,
      markedExhaustedAt: usage?.marked_exhausted_at ?? undefined,
      markedInvalidAt: usage?.marked_invalid_at ?? undefined,
    };
  }
}

