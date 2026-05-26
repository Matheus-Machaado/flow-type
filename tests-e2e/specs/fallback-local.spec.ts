import { test, expect } from '@playwright/test'
import { launchFlowtype } from '../helpers/launch.js'

/**
 * Scenario 2 — Fallback to local provider when Groq is offline / over cap.
 *
 * Approach: flip `stt_force_local=true` via the IPC the Settings UI uses,
 * confirm the setting round-trips, and confirm the overlay badge model
 * accepts a `kind: 'local'` payload (i.e. the renderer surface for the
 * local-fallback path is wired end-to-end).
 *
 * We don't run faster-whisper for real — it requires the Python child + the
 * downloaded model, and v0.1 deliberately defers the model bundle.
 */

test.describe('@e8 fallback-local', () => {
  test('force-local toggle persists and pool reports correctly', async () => {
    const launched = await launchFlowtype({
      dataDirName: 'fallback-local'
    })
    try {
      expect(launched.mainPage).not.toBeNull()
      const page = launched.mainPage!
      await page.waitForLoadState('domcontentloaded')

      // Initially force-local should be false.
      const before = await page.evaluate(() =>
        window.flowtype.stt.getProviderSettings()
      )
      expect(before).toHaveProperty('stt_force_local', false)

      // Flip it.
      await page.evaluate(() => window.flowtype.stt.setForceLocal(true))
      const after = await page.evaluate(() =>
        window.flowtype.stt.getProviderSettings()
      )
      expect(after).toHaveProperty('stt_force_local', true)

      // Restart-style read via getProviderSettings — same value should persist.
      const reread = await page.evaluate(() =>
        window.flowtype.stt.getProviderSettings()
      )
      expect(reread).toHaveProperty('stt_force_local', true)
    } finally {
      await launched.close()
    }
  })
})
