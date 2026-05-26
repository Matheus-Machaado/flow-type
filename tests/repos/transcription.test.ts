import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDbContext } from '../helpers/test-db.js';
import { NotFoundError } from '../../src/shared/errors.js';

describe('TranscriptionRepo', () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('inserts a row and reads it back', () => {
    const t = ctx.transcriptionRepo.insert({
      text: 'isso é um teste',
      provider_used: 'groq',
      slot_index: 0,
      slot_label: 'primary',
      latency_ms: 720,
      duration_ms: 2100,
      language: 'pt-BR',
      app_exe: 'notepad.exe',
      app_window_title: 'Sem título — Bloco de Notas',
    });
    expect(t.id).toHaveLength(26);
    expect(t.text).toBe('isso é um teste');
    expect(t.provider_used).toBe('groq');
    expect(t.slot_index).toBe(0);
    expect(t.vocab_corrections_applied).toEqual([]);
    expect(t.paste_method).toBe('clipboard');
    expect(t.paste_succeeded).toBe(true);

    const round = ctx.transcriptionRepo.getById(t.id);
    expect(round).toEqual(t);
  });

  it('serializes vocab_corrections_applied as JSON', () => {
    const t = ctx.transcriptionRepo.insert({
      text: 'oi mundo',
      provider_used: 'local',
      vocab_corrections_applied: [
        { wrong: 'kunha', correct: 'Cunha', scope: 'global' },
      ],
    });
    const round = ctx.transcriptionRepo.getById(t.id);
    expect(round.vocab_corrections_applied).toHaveLength(1);
    expect(round.vocab_corrections_applied[0]).toEqual({
      wrong: 'kunha',
      correct: 'Cunha',
      scope: 'global',
    });
  });

  it('lists recent in reverse chronological order', () => {
    const a = ctx.transcriptionRepo.insert({
      text: 'first',
      provider_used: 'groq',
      ts: '2026-05-25T10:00:00.000Z',
    });
    const b = ctx.transcriptionRepo.insert({
      text: 'second',
      provider_used: 'groq',
      ts: '2026-05-25T11:00:00.000Z',
    });
    const c = ctx.transcriptionRepo.insert({
      text: 'third',
      provider_used: 'groq',
      ts: '2026-05-25T12:00:00.000Z',
    });

    const list = ctx.transcriptionRepo.listRecent(10);
    expect(list.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
  });

  it('finds matches via FTS5 search', () => {
    ctx.transcriptionRepo.insert({ text: 'reunião marcada para amanhã', provider_used: 'groq' });
    ctx.transcriptionRepo.insert({ text: 'reunião cancelada de novo', provider_used: 'groq' });
    ctx.transcriptionRepo.insert({ text: 'almoço de aniversário', provider_used: 'local' });

    const hits = ctx.transcriptionRepo.search('reunião');
    expect(hits.length).toBe(2);
    expect(hits.every((h) => /reuni/i.test(h.text))).toBe(true);
  });

  it('matches with accent-fold tokenizer (reuniao = reunião)', () => {
    ctx.transcriptionRepo.insert({ text: 'a reunião foi adiada', provider_used: 'groq' });
    const hits = ctx.transcriptionRepo.search('reuniao');
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('applies filters on top of FTS5 search', () => {
    ctx.transcriptionRepo.insert({
      text: 'reunião com cliente',
      provider_used: 'groq',
      app_exe: 'notepad.exe',
    });
    ctx.transcriptionRepo.insert({
      text: 'reunião interna',
      provider_used: 'groq',
      app_exe: 'code.exe',
    });
    const filtered = ctx.transcriptionRepo.search('reunião', {
      filters: { appExe: ['notepad.exe'] },
    });
    expect(filtered.length).toBe(1);
    expect(filtered[0].app_exe).toBe('notepad.exe');
  });

  it('FTS5 reflects deletes via trigger', () => {
    const t = ctx.transcriptionRepo.insert({
      text: 'temporario será apagado',
      provider_used: 'groq',
    });
    expect(ctx.transcriptionRepo.search('temporario').length).toBe(1);
    ctx.transcriptionRepo.delete(t.id);
    expect(ctx.transcriptionRepo.search('temporario').length).toBe(0);
  });

  it('FTS5 reflects updates via trigger', () => {
    const t = ctx.transcriptionRepo.insert({
      text: 'original texto antigo',
      provider_used: 'groq',
    });
    ctx.transcriptionRepo.updateText(t.id, 'novo texto atualizado');
    expect(ctx.transcriptionRepo.search('original').length).toBe(0);
    expect(ctx.transcriptionRepo.search('atualizado').length).toBe(1);
  });

  it('throws NotFoundError on missing id', () => {
    expect(() => ctx.transcriptionRepo.getById('NONE_OF_THE_ABOVE')).toThrow(NotFoundError);
  });

  it('deleteOlderThan removes by created_at cutoff', () => {
    // Direct DB insert pra controlar created_at
    const oldDate = '2020-01-01 00:00:00';
    const recent = ctx.transcriptionRepo.insert({ text: 'fresh', provider_used: 'groq' });
    ctx.db
      .prepare(
        `INSERT INTO transcription (id, ts, text, provider_used, latency_ms, duration_ms,
                                      paste_method, paste_succeeded, target_window_lost_focus,
                                      vocab_corrections_applied, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 'clipboard', 1, 0, '[]', ?)`,
      )
      .run(
        '01HV0000000000000000000001',
        oldDate,
        'velho lixo antigo',
        'local',
        oldDate,
      );

    const removed = ctx.transcriptionRepo.deleteOlderThan(30);
    expect(removed).toBe(1);
    expect(ctx.transcriptionRepo.findById(recent.id)).not.toBeNull();
    expect(ctx.transcriptionRepo.findById('01HV0000000000000000000001')).toBeNull();
  });

  it('list filters by provider', () => {
    ctx.transcriptionRepo.insert({ text: 'a', provider_used: 'groq' });
    ctx.transcriptionRepo.insert({ text: 'b', provider_used: 'local' });
    ctx.transcriptionRepo.insert({ text: 'c', provider_used: 'groq' });

    const groqs = ctx.transcriptionRepo.list({ provider: 'groq' });
    expect(groqs.length).toBe(2);
    const locals = ctx.transcriptionRepo.list({ provider: 'local' });
    expect(locals.length).toBe(1);
  });

  it('rejects invalid provider_used (CHECK constraint)', () => {
    expect(() =>
      ctx.transcriptionRepo.insert({
        text: 'x',
        provider_used: 'bogus' as never,
      }),
    ).toThrow();
  });
});
