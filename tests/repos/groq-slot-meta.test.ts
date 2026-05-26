import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';
import { NotFoundError } from '../../src/shared/errors.js';

describe('GroqSlotMetaRepo', () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('migration seeds 3 empty slots', () => {
    const list = ctx.groqSlotMetaRepo.list();
    expect(list.length).toBe(3);
    expect(list.map((s) => s.slot_index)).toEqual([0, 1, 2]);
    for (const s of list) {
      expect(s.api_key_encrypted).toBeNull();
      expect(s.label).toBeNull();
      expect(s.daily_cap).toBe(14400);
      expect(s.validation_status).toBe('untested');
    }
  });

  it('upsert sets api key + label and added_at', () => {
    const slot = ctx.groqSlotMetaRepo.upsert(0, {
      api_key_encrypted: 'gsk_test_xxx',
      label: 'primary',
    });
    expect(slot.api_key_encrypted).toBe('gsk_test_xxx');
    expect(slot.label).toBe('primary');
    expect(slot.added_at).toBeTruthy();
  });

  it('upsert updates daily_cap and rejects non-positive', () => {
    const slot = ctx.groqSlotMetaRepo.upsert(0, { daily_cap: 7200 });
    expect(slot.daily_cap).toBe(7200);
    expect(() => ctx.groqSlotMetaRepo.upsert(0, { daily_cap: 0 })).toThrow();
  });

  it('markValidationStatus updates status + last_validated_at', () => {
    const before = ctx.groqSlotMetaRepo.get(0);
    expect(before.last_validated_at).toBeNull();

    const after = ctx.groqSlotMetaRepo.markValidationStatus(0, 'online');
    expect(after.validation_status).toBe('online');
    expect(after.last_validated_at).toBeTruthy();

    const afterInvalid = ctx.groqSlotMetaRepo.markValidationStatus(0, 'invalid');
    expect(afterInvalid.validation_status).toBe('invalid');
  });

  it('clear removes api key + label + status reset', () => {
    ctx.groqSlotMetaRepo.upsert(1, {
      api_key_encrypted: 'gsk_keep',
      label: 'backup',
      validation_status: 'online',
    });
    const cleared = ctx.groqSlotMetaRepo.clear(1);
    expect(cleared.api_key_encrypted).toBeNull();
    expect(cleared.label).toBeNull();
    expect(cleared.validation_status).toBe('untested');
    expect(cleared.added_at).toBeNull();
  });

  it('CHECK constraint rejects invalid validation_status', () => {
    expect(() =>
      ctx.db
        .prepare('UPDATE groq_slot_meta SET validation_status = ? WHERE slot_index = 0')
        .run('garbage'),
    ).toThrow();
  });

  it('CHECK constraint rejects slot_index out of 0..2', () => {
    expect(() =>
      ctx.db
        .prepare(
          `INSERT INTO groq_slot_meta (slot_index, daily_cap, validation_status)
           VALUES (3, 14400, 'untested')`,
        )
        .run(),
    ).toThrow();
  });

  it('get throws NotFoundError outside 0..2', () => {
    // Cast pra burlar tipagem
    expect(() => ctx.groqSlotMetaRepo.get(7 as 0)).toThrow(NotFoundError);
  });
});
