#!/usr/bin/env node
/**
 * Run Lighthouse against the locally-built site (`site/dist` served by
 * `astro preview`). Writes the JSON + HTML reports under `site/` and prints
 * a tabular summary.
 *
 * Targets: ≥95 in every category. The script exits 0 even when a category
 * falls short — the failure is surfaced in the summary so the owner can
 * decide whether to block release.
 */

import { spawn } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(__dirname, '..')
const siteRoot = join(projectRoot, 'site')

const PREVIEW_URL = 'http://127.0.0.1:4321/'
const TARGET = 95

function startPreview() {
  console.log('[lighthouse] launching `astro preview` in background…')
  const child = spawn('npm', ['run', 'preview'], {
    cwd: siteRoot,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (b) => process.stdout.write(`[astro] ${b}`))
  child.stderr.on('data', (b) => process.stderr.write(`[astro] ${b}`))
  return child
}

function pingOnce(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForReady(url, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await pingOnce(url)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function runLighthouse(url) {
  const lhMod = await import('lighthouse')
  const lighthouse = lhMod.default ?? lhMod
  const cdpMod = await import('chrome-launcher')
  const chrome = await cdpMod.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] })
  try {
    const result = await lighthouse(
      url,
      {
        port: chrome.port,
        output: ['json', 'html'],
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo']
      }
    )
    return result
  } finally {
    await chrome.kill()
  }
}

const preview = startPreview()
let exitCode = 0

try {
  const ready = await waitForReady(PREVIEW_URL)
  if (!ready) {
    console.error(`[lighthouse] preview did not become reachable at ${PREVIEW_URL} within 30s`)
    process.exit(1)
  }

  let result
  try {
    result = await runLighthouse(PREVIEW_URL)
  } catch (err) {
    console.error('[lighthouse] run failed:', err?.message || err)
    console.error('[lighthouse] this usually means Chrome / chrome-launcher is not installed locally.')
    console.error('[lighthouse] install with: npm install --no-save chrome-launcher')
    exitCode = 2
    throw err
  }

  const reportJson = Array.isArray(result.report) ? result.report[0] : result.report
  const reportHtml = Array.isArray(result.report) ? result.report[1] : null
  if (!existsSync(siteRoot)) mkdirSync(siteRoot, { recursive: true })
  const jsonPath = join(siteRoot, 'lighthouse-report.json')
  writeFileSync(jsonPath, reportJson, 'utf-8')
  console.log(`[lighthouse] wrote ${jsonPath}`)
  if (reportHtml) {
    const htmlPath = join(siteRoot, 'lighthouse-report.html')
    writeFileSync(htmlPath, reportHtml, 'utf-8')
    console.log(`[lighthouse] wrote ${htmlPath}`)
  }

  const categories = result.lhr.categories
  const rows = Object.values(categories).map((c) => ({
    name: c.title,
    score: Math.round(c.score * 100)
  }))
  console.log('\n[lighthouse] scores:')
  for (const r of rows) {
    const ok = r.score >= TARGET ? 'PASS' : 'BELOW TARGET'
    console.log(`  ${r.name.padEnd(20)} ${String(r.score).padStart(3)}  [${ok}]`)
  }
  const failing = rows.filter((r) => r.score < TARGET)
  if (failing.length > 0) {
    console.warn(
      `[lighthouse] ${failing.length}/${rows.length} categories below ${TARGET} — see lighthouse-report.html for diagnostics`
    )
  } else {
    console.log(`[lighthouse] all ${rows.length} categories ≥${TARGET}`)
  }
} catch (err) {
  if (exitCode === 0) exitCode = 1
} finally {
  preview.kill()
  // Give the child a beat to release the port before exit.
  setTimeout(() => process.exit(exitCode), 500)
}
