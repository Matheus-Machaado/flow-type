/**
 * vocab-applier — aplica correções pós-STT antes da injeção.
 *
 * Cobre `e4-vocab-correction-pipeline` (internal-contracts.md §3.5).
 *
 * Regras:
 *   - Cada entry com `case_sensitive=true` vira regex com flag 'g'; senão 'gi'.
 *   - Boundary `\b` em volta de `term_wrong` (escapado) — evita match no meio
 *     de palavras (ex.: 'gato' não substitui em 'gatorade').
 *   - Iteração ordenada: global primeiro, scope-específico depois (mantém
 *     prioridade do mais específico ao final).
 *   - Retorna lista `applied` com `{ id, term_wrong, term_correct, count }`
 *     pra persistência e telemetria.
 *
 * Helper puro — não toca DB. Quem chama (stt-gateway) invoca
 * `vocabRepo.incrementTimesApplied(id)` pra cada entry com count>0.
 */

import type { VocabEntry } from '../../shared/db-types.js'

export interface VocabApplied {
  id: string
  term_wrong: string
  term_correct: string
  count: number
}

export interface VocabApplyResult {
  text: string
  applied: VocabApplied[]
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g

function escapeRegex(s: string): string {
  return s.replace(REGEX_SPECIAL, '\\$&')
}

export function applyVocabCorrections(text: string, entries: VocabEntry[]): VocabApplyResult {
  if (!entries || entries.length === 0) {
    return { text, applied: [] }
  }
  let result = text
  const applied: VocabApplied[] = []
  for (const entry of entries) {
    const flags = entry.case_sensitive ? 'g' : 'gi'
    const pattern = new RegExp(`\\b${escapeRegex(entry.term_wrong)}\\b`, flags)
    let count = 0
    result = result.replace(pattern, () => {
      count += 1
      return entry.term_correct
    })
    if (count > 0) {
      applied.push({
        id: entry.id,
        term_wrong: entry.term_wrong,
        term_correct: entry.term_correct,
        count
      })
    }
  }
  return { text: result, applied }
}
