/**
 * Testes de applyPunctuationHeuristic (e3-punctuation-heuristic).
 *
 * Cobre: capitalize first, capitalize após sentence boundary, append "."
 * quando ≥3 palavras, preserva URLs/emails/code blocks, idempotência
 * (não duplica ponto), case enabled=false.
 */

import { describe, expect, it } from 'vitest';
import { applyPunctuationHeuristic } from '../../src/main/injection/punctuation-heuristic.js';

describe('applyPunctuationHeuristic', () => {
  it('capitalize first char + adds period when ≥3 words', () => {
    expect(applyPunctuationHeuristic('ola mundo isso e um teste')).toBe(
      'Ola mundo isso e um teste.',
    );
  });

  it('preserves existing terminal punctuation (no double dot)', () => {
    expect(applyPunctuationHeuristic('teste com ponto.')).toBe('Teste com ponto.');
    expect(applyPunctuationHeuristic('como vai?')).toBe('Como vai?');
    expect(applyPunctuationHeuristic('uau!')).toBe('Uau!');
    expect(applyPunctuationHeuristic('reticencias…')).toBe('Reticencias…');
  });

  it('does NOT add period when <3 words', () => {
    expect(applyPunctuationHeuristic('oi')).toBe('Oi');
    expect(applyPunctuationHeuristic('bom dia')).toBe('Bom dia');
  });

  it('capitalizes after sentence boundary ". " (3 palavras totais → adiciona "." final)', () => {
    expect(applyPunctuationHeuristic('ola. como vai')).toBe('Ola. Como vai.');
  });

  it('capitalizes after sentence boundary "! " (3 palavras → adiciona "." final)', () => {
    expect(applyPunctuationHeuristic('uau! que legal')).toBe('Uau! Que legal.');
  });

  it('handles accented chars (locale pt-BR)', () => {
    expect(applyPunctuationHeuristic('ácido fórmico tem três palavras')).toBe(
      'Ácido fórmico tem três palavras.',
    );
  });

  it('preserves URLs (does not capitalize https)', () => {
    const out = applyPunctuationHeuristic('vai em https://groq.com agora mesmo');
    expect(out).toContain('https://groq.com');
    expect(out.startsWith('Vai')).toBe(true);
  });

  it('preserves email addresses', () => {
    const out = applyPunctuationHeuristic('manda pro foo@bar.com agora mesmo');
    expect(out).toContain('foo@bar.com');
  });

  it('preserves inline code blocks (backticks)', () => {
    const out = applyPunctuationHeuristic('use o comando `ls -la` no terminal');
    expect(out).toContain('`ls -la`');
    expect(out.startsWith('Use')).toBe(true);
  });

  it('enabled=false returns trimmed text without other changes', () => {
    expect(applyPunctuationHeuristic('   ola mundo   ', { enabled: false })).toBe(
      'ola mundo',
    );
  });

  it('empty string → empty string', () => {
    expect(applyPunctuationHeuristic('')).toBe('');
    expect(applyPunctuationHeuristic('   ')).toBe('');
  });

  it('trims leading/trailing whitespace', () => {
    expect(applyPunctuationHeuristic('   ola mundo isso e teste   ')).toBe(
      'Ola mundo isso e teste.',
    );
  });

  it('multiple sentences capitalized after each boundary (3 palavras → "." final)', () => {
    expect(applyPunctuationHeuristic('um. dois. tres')).toBe('Um. Dois. Tres.');
  });
});
