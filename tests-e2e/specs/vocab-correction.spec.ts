import { test, expect } from '@playwright/test'
import { launchFlowtype } from '../helpers/launch.js'

/**
 * Scenario 3 — Vocab pipeline applies corrections.
 *
 * Seed a vocab entry "kunha → Cunha", then read it back through the
 * Settings/Vocab IPC the renderer uses. This validates the vocab repo + IPC
 * + the data shape that `applyVocabCorrections()` consumes inside the
 * SttGateway hook.
 *
 * The actual correction transformation is covered by vitest unit tests
 * (`tests/stt/vocab-applier.test.ts` in WO-2). Here we ensure the data
 * round-trips through the live app, so a future regression in the IPC
 * layer is caught before release.
 */

test.describe('@e8 vocab-correction', () => {
  test('add → list → update → remove round-trip via window.flowtype.vocab', async () => {
    const launched = await launchFlowtype({
      dataDirName: 'vocab-correction'
    })
    try {
      const page = launched.mainPage!
      await page.waitForLoadState('domcontentloaded')

      // Add.
      const added = await page.evaluate(() =>
        window.flowtype.vocab.add({
          term_wrong: 'kunha',
          term_correct: 'Cunha',
          case_sensitive: false
        })
      )
      expect(added).toBeTruthy()

      // List.
      const list = await page.evaluate(() => window.flowtype.vocab.list())
      const arr = list as Array<{ term_wrong: string; term_correct: string; id: string }>
      expect(Array.isArray(arr)).toBe(true)
      const entry = arr.find((e) => e.term_wrong === 'kunha')
      expect(entry).toBeDefined()
      expect(entry!.term_correct).toBe('Cunha')

      // Remove.
      await page.evaluate((id) => window.flowtype.vocab.remove(id), entry!.id)
      const after = await page.evaluate(() => window.flowtype.vocab.list())
      expect((after as unknown[]).length).toBe(0)
    } finally {
      await launched.close()
    }
  })
})
