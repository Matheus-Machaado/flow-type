/**
 * Testes da primitiva GroqKeyPool (e2-groq-key-pool).
 *
 * Cobre: round-robin distribuído, markExhausted/markInvalid persistente,
 * incrementUsage com auto-exhausted no cap, resetDaily, allUnavailable,
 * snapshot, getSlotApiKey.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GroqKeyPool } from '../../src/main/stt/groq-key-pool.js';
import { PoolEmptyError } from '../../src/main/stt/stt-types.js';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';

describe('GroqKeyPool', () => {
  let ctx: TestDbContext;
  let pool: GroqKeyPool;

  function seed3Online(): void {
    ctx.groqSlotMetaRepo.upsert(0, {
      api_key_encrypted: 'gsk_test_AAAA',
      label: 'a',
      validation_status: 'online',
    });
    ctx.groqSlotMetaRepo.upsert(1, {
      api_key_encrypted: 'gsk_test_BBBB',
      label: 'b',
      validation_status: 'online',
    });
    ctx.groqSlotMetaRepo.upsert(2, {
      api_key_encrypted: 'gsk_test_CCCC',
      label: 'c',
      validation_status: 'online',
    });
  }

  function buildPool(): GroqKeyPool {
    return new GroqKeyPool(ctx.groqSlotMetaRepo, ctx.tokenUsageRepo);
  }

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('next() rotates round-robin across 3 online slots → [0,1,2,0,1]', () => {
    seed3Online();
    pool = buildPool();
    const sequence: number[] = [];
    for (let i = 0; i < 5; i++) {
      sequence.push(pool.next().slotIndex);
    }
    expect(sequence).toEqual([0, 1, 2, 0, 1]);
  });

  it('next() skips exhausted slot → markExhausted(1) yields [0,2,0]', () => {
    seed3Online();
    pool = buildPool();
    pool.markExhausted(1);
    const sequence: number[] = [];
    for (let i = 0; i < 3; i++) {
      sequence.push(pool.next().slotIndex);
    }
    expect(sequence).toEqual([0, 2, 0]);
  });

  it('next() skips invalid slot', () => {
    seed3Online();
    pool = buildPool();
    pool.markInvalid(0);
    const sequence: number[] = [];
    for (let i = 0; i < 3; i++) {
      sequence.push(pool.next().slotIndex);
    }
    // 0 está invalid → rotação roda só entre 1 e 2.
    expect(sequence).toEqual([1, 2, 1]);
  });

  it('markInvalid(0) + markExhausted(2) + markExhausted(1) → allUnavailable=true, next() throws PoolEmptyError', () => {
    seed3Online();
    pool = buildPool();
    pool.markInvalid(0);
    pool.markExhausted(2);
    pool.markExhausted(1);
    expect(pool.allUnavailable()).toBe(true);
    expect(pool.onlineCount()).toBe(0);
    expect(() => pool.next()).toThrow(PoolEmptyError);
  });

  it('resetDaily() clears exhausted but keeps invalid', () => {
    seed3Online();
    pool = buildPool();
    pool.markExhausted(0);
    pool.markInvalid(1);
    expect(pool.snapshot().exhausted).toBe(1);
    expect(pool.snapshot().invalid).toBe(1);

    pool.resetDaily();
    const snap = pool.snapshot();
    expect(snap.exhausted).toBe(0);
    expect(snap.invalid).toBe(1); // invalid persiste
    expect(snap.online).toBe(2); // 0 e 2 voltam
  });

  it('incrementUsage() persists and auto-marks exhausted at daily_cap', () => {
    ctx.groqSlotMetaRepo.upsert(0, {
      api_key_encrypted: 'gsk_test_low',
      label: 'low',
      daily_cap: 3,
      validation_status: 'online',
    });
    pool = buildPool();
    expect(pool.incrementUsage(0, 1)).toBe(1);
    expect(pool.snapshot().slots[0].status).toBe('online');
    expect(pool.incrementUsage(0, 1)).toBe(2);
    expect(pool.snapshot().slots[0].status).toBe('online');
    expect(pool.incrementUsage(0, 1)).toBe(3);
    // 3 >= cap → auto-exhausted
    expect(pool.snapshot().slots[0].status).toBe('exhausted');
  });

  it('snapshot() reflects all 3 slots with derived status + counters', () => {
    seed3Online();
    pool = buildPool();
    pool.incrementUsage(0, 5);
    pool.incrementUsage(1, 10);
    pool.markExhausted(2);
    const snap = pool.snapshot();

    expect(snap.totalSlots).toBe(3);
    expect(snap.slots).toHaveLength(3);
    expect(snap.online).toBe(2);
    expect(snap.exhausted).toBe(1);
    expect(snap.invalid).toBe(0);
    expect(snap.totalUsedToday).toBe(15);

    const slot0 = snap.slots[0];
    expect(slot0.hasKey).toBe(true);
    expect(slot0.label).toBe('a');
    expect(slot0.usedToday).toBe(5);
    expect(slot0.dailyCap).toBe(14400);
    expect(slot0.pctUsed).toBe(0); // 5/14400 ~ 0%
  });

  it('slot without key is treated as invalid (not picked by next)', () => {
    ctx.groqSlotMetaRepo.upsert(0, {
      api_key_encrypted: 'gsk_only_one',
      label: 'only',
      validation_status: 'online',
    });
    // 1 e 2 vazios (status default 'untested')
    pool = buildPool();
    const snap = pool.snapshot();
    expect(snap.slots[1].hasKey).toBe(false);
    expect(snap.slots[1].status).toBe('invalid');
    expect(snap.slots[2].hasKey).toBe(false);
    expect(snap.slots[2].status).toBe('invalid');

    // next() sempre retorna slot 0
    for (let i = 0; i < 4; i++) {
      expect(pool.next().slotIndex).toBe(0);
    }
  });

  it('slot with key but validation_status=untested is treated as invalid', () => {
    ctx.groqSlotMetaRepo.upsert(0, {
      api_key_encrypted: 'gsk_untested',
      label: 'untested',
      // não passa validation_status → default seed é 'untested'
    });
    pool = buildPool();
    const snap = pool.snapshot();
    expect(snap.slots[0].hasKey).toBe(true);
    expect(snap.slots[0].validationStatus).toBe('untested');
    expect(snap.slots[0].status).toBe('invalid');
    expect(pool.allUnavailable()).toBe(true);
  });

  it('setSlot() updates key + label + dailyCap and markOnline marks online', () => {
    pool = buildPool();
    pool.setSlot(1, {
      apiKey: 'gsk_inserted',
      label: 'inserted',
      dailyCap: 7200,
      validationOk: true,
    });
    const snap = pool.snapshot();
    expect(snap.slots[1].hasKey).toBe(true);
    expect(snap.slots[1].label).toBe('inserted');
    expect(snap.slots[1].dailyCap).toBe(7200);
    expect(snap.slots[1].status).toBe('online');
  });

  it('clearSlot() removes key and resets status', () => {
    seed3Online();
    pool = buildPool();
    pool.clearSlot(1);
    const snap = pool.snapshot();
    expect(snap.slots[1].hasKey).toBe(false);
    expect(snap.slots[1].status).toBe('invalid');
  });

  it('getSlotApiKey returns raw key without consuming round-robin', () => {
    seed3Online();
    pool = buildPool();
    const before = pool.next().slotIndex; // consome 0
    expect(before).toBe(0);
    expect(pool.getSlotApiKey(2)).toBe('gsk_test_CCCC');
    // próxima chamada continua rotação normal
    expect(pool.next().slotIndex).toBe(1);
  });

  it('uniform distribution: 60 calls across 3 online slots → 20±1 each', () => {
    seed3Online();
    pool = buildPool();
    const counts = [0, 0, 0];
    for (let i = 0; i < 60; i++) {
      counts[pool.next().slotIndex]++;
    }
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(19);
      expect(c).toBeLessThanOrEqual(21);
    }
  });

  it('resetDaily re-aims round-robin pointer to first online slot', () => {
    seed3Online();
    pool = buildPool();
    // Esgota o slot 0 manualmente
    pool.markExhausted(0);
    expect(pool.next().slotIndex).toBe(1);
    expect(pool.next().slotIndex).toBe(2);
    expect(pool.next().slotIndex).toBe(1);
    // Reset
    pool.resetDaily();
    // Após reset, ponteiro deve estar em primeiro online (slot 0)
    expect(pool.next().slotIndex).toBe(0);
  });
});
