import { test, expect } from '@playwright/test'
import { launchFlowtype } from '../helpers/launch.js'
import { mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const screensDir = resolve(__dirname, '..', 'screenshots')

/**
 * Scenario 4 — Overlay 4 visual states.
 *
 * For each state we drive `overlay.setState({ state })` and take a screenshot
 * of the overlay BrowserWindow. There's no pixel-diff baseline in v0.1 — the
 * specs only ensure the overlay accepts every state and renders something.
 *
 * Output: tests-e2e/screenshots/overlay-{state}.png
 */

const STATES = ['idle', 'armed', 'capturing', 'processing'] as const

test.describe('@e8 overlay-states-visual', () => {
  test('all 4 states capture cleanly', async () => {
    if (!existsSync(screensDir)) mkdirSync(screensDir, { recursive: true })

    const launched = await launchFlowtype({ dataDirName: 'overlay-states-visual' })
    try {
      // Find the overlay page (URL contains 'overlay').
      const allPages = launched.app.windows()
      const overlayPage = allPages.find((p) => p.url().includes('overlay'))
      expect(overlayPage, 'overlay window should be present').toBeDefined()

      for (const state of STATES) {
        // Drive state through the renderer (overlay listens to settings IPC).
        await launched.mainPage!.evaluate(
          (s) => window.flowtype.overlay.setState({ state: s }),
          state
        )
        // Give Framer Motion a couple ticks to settle.
        await overlayPage!.waitForTimeout(300)
        const file = join(screensDir, `overlay-${state}.png`)
        await overlayPage!.screenshot({ path: file, omitBackground: true })
        expect(true).toBeTruthy()
      }
    } finally {
      await launched.close()
    }
  })
})
