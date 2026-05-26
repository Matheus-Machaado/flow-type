#!/usr/bin/env node
/**
 * Cross-platform Playwright-Electron runner. Ensures the renderer/main bundles
 * are up to date, then launches Playwright with the e2e-only config.
 *
 * Set FLOWTYPE_SKIP_BUILD=1 to reuse the existing `out/` (useful in CI when
 * the build step is already cached).
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(__dirname, '..')

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: projectRoot,
    shell: process.platform === 'win32',
    ...opts
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (!process.env.FLOWTYPE_SKIP_BUILD) {
  run('npm', ['run', 'build'])
} else {
  if (!existsSync(join(projectRoot, 'out', 'main', 'index.js'))) {
    console.error('[run-e2e] FLOWTYPE_SKIP_BUILD=1 but out/main/index.js missing')
    process.exit(1)
  }
}

// Playwright is loaded via the @playwright/test CLI which picks up
// tests-e2e/playwright.config.ts automatically.
run('npx', ['playwright', 'test', '--config=tests-e2e/playwright.config.ts'])
