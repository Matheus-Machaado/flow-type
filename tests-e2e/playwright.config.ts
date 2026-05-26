import { defineConfig } from '@playwright/test'

/**
 * Playwright-Electron config — runs the built `out/main/index.js` against
 * the renderer in tests-e2e/specs/. Use `npm run test:e2e` (which calls
 * scripts/run-e2e.mjs) instead of invoking `npx playwright test` directly,
 * so the build step is guaranteed fresh.
 *
 * Note: this is NOT a browser test — we use Playwright's experimental
 * Electron driver (`_electron`). All specs that need uIOhook/nut.js/PowerShell
 * mark themselves skip-on-CI; the headless container has no Windows kernel
 * APIs to talk to, so we exercise the IPC surface + renderer instead.
 */
export default defineConfig({
  testDir: './specs',
  // E2E suites are serialized — they share one Electron app instance via
  // launch helpers and the userData directory lives under tests-e2e/tmp/.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  reporter: [
    ['list'],
    ['json', { outputFile: '../test-results/e2e-report.json' }]
  ],
  use: {
    actionTimeout: 5_000
  },
  outputDir: '../test-results/e2e-output'
})
