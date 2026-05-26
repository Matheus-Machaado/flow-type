/**
 * audit-wo4.mjs — auditoria visual headless do WO-4 (UI React real).
 *
 * Serve o renderer build sobre HTTP loopback e roda Playwright (chromium)
 * contra cada rota (`/` Home, `/?view=settings`, `/?view=history`), capturando
 * screenshots em `.studio/screenshots/flowtype/<DATE>-impl/wo4-*.png`.
 *
 * Para a seção GroqProviderSection (CR-2 progressivo), injetamos
 * `window.__flowtypeMock.providerSettings` ANTES do React montar pra renderizar
 * cada um dos 4 estados (0 / 1 / 2 / 3 keys preenchidas).
 *
 * Critérios validados:
 *  - 0 page errors
 *  - 0 console errors
 *  - texto "Flow Type" presente no header
 *  - nenhum "Wispr" / "Slot #1" / "Pool de" no DOM final
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const ROOT = resolve(process.cwd(), 'out/renderer')
const DATE_DIR = '2026-05-25-impl'
const OUT_DIR = resolve(process.cwd(), '../../.studio/screenshots/flowtype', DATE_DIR)
const PORT = 5677

if (!existsSync(ROOT)) {
  console.error(`Build output not found at ${ROOT}. Run \`npm run build\` first.`)
  process.exit(1)
}
mkdirSync(OUT_DIR, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`)
    let path = decodeURIComponent(url.pathname)
    if (path === '/' || path.endsWith('/')) path += 'index.html'
    const fp = join(ROOT, path)
    if (!fp.startsWith(ROOT)) {
      res.statusCode = 403
      return res.end('forbidden')
    }
    if (!existsSync(fp)) {
      res.statusCode = 404
      return res.end('not found')
    }
    const body = readFileSync(fp)
    res.setHeader('Content-Type', MIME[extname(fp)] || 'application/octet-stream')
    res.end(body)
  } catch (e) {
    res.statusCode = 500
    res.end(String(e))
  }
})

await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/`)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 800 },
  deviceScaleFactor: 1.5
})

const FORBIDDEN_TEXTS = ['Wispr', 'Slot #1', 'Slot #2', 'Slot #3', 'Slot 1 de 3', 'Pool de']
const errors = []

/**
 * Goes to a URL, optionally injects mock state via initScript, waits for
 * React to mount, takes a screenshot, and runs forbidden-text + console
 * assertions.
 */
async function shoot({ name, url, viewport, mock, settle = 500, assertBrand = true }) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`[pageerror ${name}] ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error ${name}] ${m.text()}`)
  })
  if (viewport) await page.setViewportSize(viewport)
  if (mock) {
    await page.addInitScript((m) => {
      window.__flowtypeMock = m
    }, mock)
  }
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(settle)
  const file = join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path: file, omitBackground: false, fullPage: true })

  const text = await page.evaluate(() => document.body.innerText)
  for (const forbidden of FORBIDDEN_TEXTS) {
    if (text.includes(forbidden)) {
      errors.push(`[forbidden text in ${name}] "${forbidden}" found in DOM`)
    }
  }
  if (assertBrand && !text.includes('Flow Type')) {
    errors.push(`[missing brand in ${name}] "Flow Type" not found in DOM`)
  }
  console.log('wrote', file)
  await page.close()
}

const baseUrl = `http://127.0.0.1:${PORT}/index.html`

// ── Home ──
await shoot({
  name: 'wo4-home',
  url: `${baseUrl}`
})

// ── Settings — Groq, estados progressivos ──
const slotTemplate = (overrides) => ({
  slotIndex: 0,
  hasKey: false,
  status: 'online',
  usedToday: 0,
  dailyCap: 14400,
  pctUsed: 0,
  ...overrides
})

const mockProvider = (fills) => ({
  providerSettings: {
    stt_force_local: false,
    stt_language: null,
    slots: {
      totalSlots: 3,
      online: fills.length,
      invalid: 0,
      exhausted: 0,
      totalUsedToday: fills.reduce((a, s) => a + (s.usedToday ?? 0), 0),
      slots: [0, 1, 2].map((i) => {
        const f = fills.find((s) => s.slotIndex === i)
        return slotTemplate({ slotIndex: i, ...(f || {}) })
      })
    }
  }
})

await shoot({
  name: 'wo4-settings-stt-0slots',
  url: `${baseUrl}?view=settings`,
  mock: mockProvider([])
})

await shoot({
  name: 'wo4-settings-stt-1slot',
  url: `${baseUrl}?view=settings`,
  mock: mockProvider([
    {
      slotIndex: 0,
      hasKey: true,
      label: 'pessoal',
      apiKeyTail: 'a8x1',
      status: 'online',
      usedToday: 1200,
      pctUsed: 8
    }
  ])
})

await shoot({
  name: 'wo4-settings-stt-2slots',
  url: `${baseUrl}?view=settings`,
  mock: mockProvider([
    {
      slotIndex: 0,
      hasKey: true,
      label: 'pessoal',
      apiKeyTail: 'a8x1',
      status: 'online',
      usedToday: 1200,
      pctUsed: 8
    },
    {
      slotIndex: 1,
      hasKey: true,
      label: 'trabalho',
      apiKeyTail: 'k2n9',
      status: 'online',
      usedToday: 3400,
      pctUsed: 24
    }
  ])
})

await shoot({
  name: 'wo4-settings-stt-3slots',
  url: `${baseUrl}?view=settings`,
  mock: mockProvider([
    {
      slotIndex: 0,
      hasKey: true,
      label: 'pessoal',
      apiKeyTail: 'a8x1',
      status: 'online',
      usedToday: 1200,
      pctUsed: 8
    },
    {
      slotIndex: 1,
      hasKey: true,
      label: 'trabalho',
      apiKeyTail: 'k2n9',
      status: 'online',
      usedToday: 3400,
      pctUsed: 24
    },
    {
      slotIndex: 2,
      hasKey: true,
      label: 'projeto-x',
      apiKeyTail: 'q4t7',
      status: 'exhausted',
      usedToday: 14400,
      pctUsed: 100
    }
  ])
})

// ── Settings — outras seções ──
const sectionsToShoot = ['hotkey', 'microfone', 'idioma', 'vocab', 'autostart', 'sobre']
for (const s of sectionsToShoot) {
  // For these, we don't need provider mock; pass empty.
  await shoot({
    name: `wo4-settings-${s}`,
    url: `${baseUrl}?view=settings`,
    mock: mockProvider([]),
    settle: 600,
    // Programmatically click the sidebar entry after load.
    // Easier: pre-set initial section via custom hash? We'll click via evaluate.
    // But shoot helper doesn't support post-actions; do inline below.
  })
}
// The default initialSection in SettingsApp is 'stt'. To target other sections
// in screenshots, we open the same view and click the sidebar item. Re-shoot:
for (const s of sectionsToShoot) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`[pageerror settings-${s}] ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error settings-${s}] ${m.text()}`)
  })
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.addInitScript((m) => {
    window.__flowtypeMock = m
  }, mockProvider([]))
  await page.goto(`${baseUrl}?view=settings`, { waitUntil: 'load' })
  await page.waitForTimeout(300)
  // Click sidebar button by label
  const labelMap = {
    hotkey: 'Hotkey',
    microfone: 'Microfone',
    idioma: 'Idioma',
    vocab: 'Vocabulário',
    autostart: 'Auto-start',
    sobre: 'Sobre'
  }
  const label = labelMap[s]
  await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.waitForTimeout(300)
  const file = join(OUT_DIR, `wo4-settings-${s}.png`)
  await page.screenshot({ path: file, omitBackground: false, fullPage: true })
  const text = await page.evaluate(() => document.body.innerText)
  for (const forbidden of FORBIDDEN_TEXTS) {
    if (text.includes(forbidden)) {
      errors.push(`[forbidden text in settings-${s}] "${forbidden}" in DOM`)
    }
  }
  if (!text.includes('Flow Type')) {
    errors.push(`[missing brand in settings-${s}] "Flow Type" missing in DOM`)
  }
  console.log('wrote', file)
  await page.close()
}

// ── History ──
await shoot({
  name: 'wo4-history-timeline',
  url: `${baseUrl}?view=history`
})

// History empty
await shoot({
  name: 'wo4-history-empty',
  url: `${baseUrl}?view=history`,
  mock: { historyList: [] }
})

// History search active
const histPage = await ctx.newPage()
histPage.on('pageerror', (e) => errors.push(`[pageerror history-search] ${e.message}`))
histPage.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console.error history-search] ${m.text()}`)
})
await histPage.setViewportSize({ width: 1200, height: 800 })
await histPage.goto(`${baseUrl}?view=history`, { waitUntil: 'load' })
await histPage.waitForTimeout(400)
await histPage.getByRole('searchbox', { name: 'Buscar no histórico' }).fill('reunião')
await histPage.waitForTimeout(500)
const histSearchFile = join(OUT_DIR, 'wo4-history-search.png')
await histPage.screenshot({ path: histSearchFile, fullPage: true })
console.log('wrote', histSearchFile)
const histText = await histPage.evaluate(() => document.body.innerText)
for (const forbidden of FORBIDDEN_TEXTS) {
  if (histText.includes(forbidden)) {
    errors.push(`[forbidden text in history-search] "${forbidden}" in DOM`)
  }
}
await histPage.close()

await browser.close()
server.close()

if (errors.length > 0) {
  console.error('\n=== AUDIT FAILURES ===')
  for (const e of errors) console.error('  -', e)
  process.exit(1)
}

console.log('\n=== AUDIT PASS ===')
console.log(`screenshots: ${OUT_DIR}`)
