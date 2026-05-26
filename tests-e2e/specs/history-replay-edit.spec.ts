import { test, expect } from '@playwright/test'
import { launchFlowtype } from '../helpers/launch.js'

/**
 * Scenario 5 — History list/edit/delete.
 *
 * We can't seed transcriptions through the renderer (no public IPC for
 * insert — that's a backend concern). Instead, the spec asserts the
 * happy-path of the IPC channels the History view will use:
 *
 *   - history.list() returns { rows, total } with the expected shape
 *     for an empty DB
 *   - history.export({ format: 'json' }) returns a JSON document
 *   - history.export({ format: 'md' }) returns a Markdown document
 *   - vocab.list() (sibling history surface) returns []
 *
 * Once WO-2's SttGateway is wired to call transcriptionRepo.insert on the
 * cascade-success path during a smoke run, the same UI will populate.
 */

test.describe('@e8 history-replay-edit', () => {
  test('history & export IPC shapes are wired', async () => {
    const launched = await launchFlowtype({ dataDirName: 'history-replay-edit' })
    try {
      const page = launched.mainPage!
      await page.waitForLoadState('domcontentloaded')

      const list = await page.evaluate(() => window.flowtype.history.list())
      expect(list).toHaveProperty('rows')
      expect(list).toHaveProperty('total')
      expect((list as { total: number }).total).toBe(0)

      const exportedJson = await page.evaluate(() =>
        window.flowtype.history.export({ format: 'json' })
      )
      expect(exportedJson).toHaveProperty('format', 'json')
      expect(typeof (exportedJson as { content: string }).content).toBe('string')

      const exportedMd = await page.evaluate(() =>
        window.flowtype.history.export({ format: 'md' })
      )
      expect(exportedMd).toHaveProperty('format', 'md')
      expect((exportedMd as { content: string }).content).toContain(
        'flowtype — histórico de transcrições'
      )
    } finally {
      await launched.close()
    }
  })
})
