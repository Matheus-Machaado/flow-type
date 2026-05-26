import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';

const TODAY = '2026-05-25';

describe('TokenUsageRepo', () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('increment creates row on first call (UPSERT)', () => {
    const row = ctx.tokenUsageRepo.increment('groq', 0, 'primary', 1, TODAY);
    expect(row.provider).toBe('groq');
    expect(row.slot_index).toBe(0);
    expect(row.day).toBe(TODAY);
    expect(row.requests_count).toBe(1);
    expect(row.last_used_at).toBeTruthy();
    expect(row.slot_label).toBe('primary');
  });

  it('increment accumulates on same (provider, slot, day)', () => {
    ctx.tokenUsageRepo.increment('groq', 0, 'primary', 1, TODAY);
    ctx.tokenUsageRepo.increment('groq', 0, 'primary', 1, TODAY);
    const row = ctx.tokenUsageRepo.increment('groq', 0, 'primary', 4, TODAY);
    expect(row.requests_count).toBe(6);
  });

  it('snapshot returns rows for the day sorted by slot_index', () => {
    ctx.tokenUsageRepo.increment('groq', 0, 'primary', 2, TODAY);
    ctx.tokenUsageRepo.increment('groq', 2, 'tertiary', 5, TODAY);
    ctx.tokenUsageRepo.increment('groq', 1, 'backup', 3, TODAY);
    const snap = ctx.tokenUsageRepo.snapshot('groq', TODAY);
    expect(snap.length).toBe(3);
    expect(snap.map((s) => s.slot_index)).toEqual([0, 1, 2]);
    expect(snap.map((s) => s.requests_count)).toEqual([2, 3, 5]);
  });

  it('markExhausted sets marked_exhausted_at without bumping count', () => {
    ctx.tokenUsageRepo.increment('groq', 0, 'primary', 10, TODAY);
    ctx.tokenUsageRepo.markExhausted('groq', 0, TODAY);
    const snap = ctx.tokenUsageRepo.snapshot('groq', TODAY);
    expect(snap[0].marked_exhausted_at).toBeTruthy();
    expect(snap[0].requests_count).toBe(10);
  });

  it('markExhausted creates row when none exists', () => {
    ctx.tokenUsageRepo.markExhausted('groq', 1, TODAY);
    const snap = ctx.tokenUsageRepo.snapshot('groq', TODAY);
    const row = snap.find((s) => s.slot_index === 1);
    expect(row).toBeDefined();
    expect(row!.marked_exhausted_at).toBeTruthy();
    expect(row!.requests_count).toBe(0);
  });

  it('markInvalid sets marked_invalid_at', () => {
    ctx.tokenUsageRepo.markInvalid('groq', 2, TODAY);
    const snap = ctx.tokenUsageRepo.snapshot('groq', TODAY);
    const row = snap.find((s) => s.slot_index === 2)!;
    expect(row.marked_invalid_at).toBeTruthy();
    expect(row.marked_exhausted_at).toBeNull();
  });

  it('resetDaily clears exhausted (keeps invalid)', () => {
    ctx.tokenUsageRepo.markExhausted('groq', 0, TODAY);
    ctx.tokenUsageRepo.markInvalid('groq', 1, TODAY);
    const reset = ctx.tokenUsageRepo.resetDaily(TODAY);
    expect(reset).toBe(1);

    const snap = ctx.tokenUsageRepo.snapshot('groq', TODAY);
    const slot0 = snap.find((s) => s.slot_index === 0)!;
    const slot1 = snap.find((s) => s.slot_index === 1)!;
    expect(slot0.marked_exhausted_at).toBeNull();
    expect(slot1.marked_invalid_at).toBeTruthy();
  });

  it('cleanup removes rows older than N days', () => {
    // Direct insert pra controlar day
    ctx.db
      .prepare(
        `INSERT INTO token_usage (id, provider, slot_index, day, requests_count)
         VALUES ('01ID', 'groq', 0, '2020-01-01', 5)`,
      )
      .run();
    ctx.tokenUsageRepo.increment('groq', 1, 'p', 1, TODAY);

    const removed = ctx.tokenUsageRepo.cleanup(30);
    expect(removed).toBe(1);
    const snap = ctx.tokenUsageRepo.snapshot('groq', TODAY);
    expect(snap.length).toBe(1);
  });

  it('UNIQUE(provider, slot_index, day) enforced', () => {
    ctx.tokenUsageRepo.increment('groq', 0, null, 1, TODAY);
    // Inserir manualmente uma row duplicada deve falhar
    expect(() =>
      ctx.db
        .prepare(
          `INSERT INTO token_usage (id, provider, slot_index, day, requests_count)
           VALUES ('XX', 'groq', 0, ?, 1)`,
        )
        .run(TODAY),
    ).toThrow();
  });
});
