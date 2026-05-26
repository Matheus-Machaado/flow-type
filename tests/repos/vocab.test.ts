import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';
import { NotFoundError, ValidationError } from '../../src/shared/errors.js';

describe('VocabRepo', () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('adds and retrieves entries', () => {
    const e = ctx.vocabRepo.add({
      term_wrong: 'kunha',
      term_correct: 'Cunha',
      scope: 'global',
    });
    expect(e.id).toHaveLength(26);
    expect(e.term_wrong).toBe('kunha');
    expect(e.term_correct).toBe('Cunha');
    expect(e.case_sensitive).toBe(false);
    expect(e.scope).toBe('global');
    expect(e.times_applied).toBe(0);

    const got = ctx.vocabRepo.getById(e.id);
    expect(got.id).toBe(e.id);
  });

  it('lowercases scope on insert and update', () => {
    const e = ctx.vocabRepo.add({
      term_wrong: 'js',
      term_correct: 'JavaScript',
      case_sensitive: true,
      scope: 'Code.EXE',
    });
    expect(e.scope).toBe('code.exe');
    const upd = ctx.vocabRepo.update(e.id, { scope: 'NoTepAd.EXE' });
    expect(upd.scope).toBe('notepad.exe');
  });

  it('getByScope returns global + scoped', () => {
    ctx.vocabRepo.add({ term_wrong: 'kunha', term_correct: 'Cunha', scope: 'global' });
    ctx.vocabRepo.add({
      term_wrong: 'js',
      term_correct: 'JavaScript',
      scope: 'code.exe',
    });
    ctx.vocabRepo.add({
      term_wrong: 'rb',
      term_correct: 'Ruby',
      scope: 'sublime.exe',
    });

    const forCode = ctx.vocabRepo.getByScope('code.exe');
    expect(forCode.length).toBe(2);
    expect(forCode.map((e) => e.term_wrong).sort()).toEqual(['js', 'kunha']);

    const forSublime = ctx.vocabRepo.getByScope('sublime.exe');
    expect(forSublime.length).toBe(2);
    expect(forSublime.map((e) => e.term_wrong).sort()).toEqual(['kunha', 'rb']);

    const globalOnly = ctx.vocabRepo.getByScope();
    expect(globalOnly.length).toBe(1);
    expect(globalOnly[0].term_wrong).toBe('kunha');
  });

  it('updates entries partially', () => {
    const e = ctx.vocabRepo.add({ term_wrong: 'js', term_correct: 'JavaScript' });
    const updated = ctx.vocabRepo.update(e.id, { case_sensitive: true });
    expect(updated.case_sensitive).toBe(true);
    expect(updated.term_wrong).toBe('js');
  });

  it('rejects empty terms on insert', () => {
    expect(() =>
      ctx.vocabRepo.add({ term_wrong: '', term_correct: 'Cunha' } as never),
    ).toThrow(ValidationError);
  });

  it('rejects empty terms on update', () => {
    const e = ctx.vocabRepo.add({ term_wrong: 'foo', term_correct: 'Foo' });
    expect(() => ctx.vocabRepo.update(e.id, { term_correct: '' })).toThrow(ValidationError);
  });

  it('removes entries', () => {
    const e = ctx.vocabRepo.add({ term_wrong: 'temp', term_correct: 'Temp' });
    ctx.vocabRepo.remove(e.id);
    expect(() => ctx.vocabRepo.getById(e.id)).toThrow(NotFoundError);
  });

  it('incrementTimesApplied bumps counter', () => {
    const e = ctx.vocabRepo.add({ term_wrong: 'a', term_correct: 'A' });
    ctx.vocabRepo.incrementTimesApplied(e.id);
    ctx.vocabRepo.incrementTimesApplied(e.id, 3);
    const got = ctx.vocabRepo.getById(e.id);
    expect(got.times_applied).toBe(4);
  });

  it('list returns most recently updated first', () => {
    const a = ctx.vocabRepo.add({ term_wrong: 'a', term_correct: 'A' });
    ctx.vocabRepo.add({ term_wrong: 'b', term_correct: 'B' });
    // bump A so it goes first
    ctx.vocabRepo.update(a.id, { term_correct: 'AA' });
    const list = ctx.vocabRepo.list();
    expect(list[0].term_wrong).toBe('a');
  });
});
