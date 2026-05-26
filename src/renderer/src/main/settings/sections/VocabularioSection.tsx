import { VocabList } from '../VocabList'

/**
 * VocabularioSection — wrapper fino sobre VocabList existente.
 * Mantido separado pra parecer com as outras sections (consistência).
 */
export function VocabularioSection(): JSX.Element {
  return <VocabList />
}
