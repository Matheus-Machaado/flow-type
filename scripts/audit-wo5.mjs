/**
 * audit-wo5.mjs — auditoria visual headless do WO-5 (Onboarding wizard).
 *
 * Serve o renderer build sobre HTTP loopback e roda Playwright (chromium)
 * contra cada um dos 4 passos do wizard, capturando screenshots em
 * `.studio/screenshots/flowtype/<DATE>-impl/wo5-*.png`.
 *
 * O wizard só aparece quando `settings.first_run_completed === false`.
 * No harness sem Electron, forçamos via `window.__flowtypeMock.forceOnboarding=true`
 * (lido pelo MainApp). Cada passo é alcançado clicando no botão "Próximo →"
 * sequencialmente, escutando o `data-testid` distinto de cada StepFrame.
 *
 * Para o step 4 (state A: empty) injetamos um snapshot com zero slots.
 * Para o step 4 (state B: key cadastrada) injetamos snapshot com slot 0 hasKey=true.
 * Para o "success state" do step 4 disparamos o botão "gravar 5s e testar"
 * que cai em modo demo (1.2s latency) e captura após render do resultado.
 *
 * Critérios validados:
 *  - 0 page errors
 *  - 0 console errors
 *  - texto "Flow Type" presente em algum lugar do DOM
 *  - nenhum "Wispr" / "Slot #" / "Pool de" / "3 slots" / "round-robin" no DOM
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const ROOT = resolve(process.cwd(), 'out/renderer')
const DATE_DIR = '2026-05-25-impl'
const OUT_DIR = resolve(process.cwd(), '../../.studio/screenshots/flowtype', DATE_DIR)
const PORT = 5678

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
  viewport: { width: 1100, height: 760 },
  deviceScaleFactor: 1.5
})

const FORBIDDEN_TEXTS = [
  'Wispr',
  'wispr',
  'Slot #',
  'Slot 1 de',
  'Pool de',
  '3 slots',
  'round-robin',
  'round robin',
  'multi-key',
  'triplicar'
]
const errors = []

// Provider mock helpers (replicate WO-4 shape so MainApp can branch).
const makeProviderMock = (fills) => ({
  providerSettings: {
    stt_force_local: false,
    stt_language: null,
    slots: {
      totalSlots: 3,
      online: fills.length,
      invalid: 0,
      exhausted: 0,
      totalUsedToday: 0,
      slots: [0, 1, 2].map((i) => {
        const f = fills.find((s) => s.slotIndex === i)
        return f
          ? { slotIndex: i, hasKey: true, status: 'online', usedToday: 0, dailyCap: 14400, pctUsed: 0, ...f }
          : { slotIndex: i, hasKey: false, status: 'online', usedToday: 0, dailyCap: 14400, pctUsed: 0 }
      })
    }
  }
})

const baseUrl = `http://127.0.0.1:${PORT}/index.html?view=onboarding`

async function openWizard({ fills = [], extraInit } = {}) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`)
  })
  await page.addInitScript(
    ({ provider, extra }) => {
      window.__flowtypeMock = {
        ...(window.__flowtypeMock || {}),
        ...provider,
        forceOnboarding: true,
        ...(extra || {})
      }
    },
    { provider: makeProviderMock(fills), extra: extraInit }
  )
  await page.goto(baseUrl, { waitUntil: 'load' })
  // Wait for wizard step 1 to render.
  await page.waitForSelector('[data-testid="onboarding-step-welcome"]', { timeout: 5000 })
  return page
}

async function shoot(page, name) {
  const file = join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path: file, omitBackground: false, fullPage: true })
  console.log('wrote', file)
  const text = await page.evaluate(() => document.body.innerText)
  for (const forbidden of FORBIDDEN_TEXTS) {
    if (text.toLowerCase().includes(forbidden.toLowerCase())) {
      errors.push(`[forbidden text in ${name}] "${forbidden}" found in DOM`)
    }
  }
  if (!text.includes('Flow Type')) {
    errors.push(`[missing brand in ${name}] "Flow Type" not found in DOM`)
  }
}

async function clickNext(page) {
  // Primary button label is "Próximo →" / "Começar →" / "Concluir ✓".
  // We click whichever button is enabled at the bottom-right of the StepFrame.
  await page
    .locator('section[aria-labelledby="onboarding-step-title"] >> footer button')
    .last()
    .click()
}

// ── Step 1: Welcome ─────────────────────────────────────────────────
{
  const page = await openWizard()
  await page.waitForTimeout(220)
  await shoot(page, 'wo5-step1-welcome')
  await page.close()
}

// ── Step 2: Microphone ──────────────────────────────────────────────
// Mocking getUserMedia + enumerateDevices ANTES da page load so the granted
// state renders consistently without a real OS prompt.
{
  const page = await openWizard()
  await page.evaluate(() => {
    const fakeStream = {
      getTracks: () => [
        {
          stop: () => {
            // noop
          }
        }
      ]
    }
    const fakeDevices = [
      { kind: 'audioinput', deviceId: 'default', label: 'Default Mic', groupId: 'g1' },
      { kind: 'audioinput', deviceId: 'mic-a', label: 'Headset USB', groupId: 'g2' },
      { kind: 'audioinput', deviceId: 'mic-b', label: 'Webcam Built-in', groupId: 'g3' }
    ]
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream,
        enumerateDevices: async () => fakeDevices
      }
    })
  })
  await clickNext(page)
  await page.waitForSelector('[data-testid="onboarding-step-mic"]', { timeout: 5000 })
  // Click "Permitir acesso ao microfone"
  await page.getByRole('button', { name: /Permitir acesso ao microfone/i }).click()
  await page.waitForTimeout(450)
  await shoot(page, 'wo5-step2-mic')
  await page.close()
}

// ── Step 3: Hotkey ──────────────────────────────────────────────────
{
  const page = await openWizard()
  // Step 1 → 2
  await page.evaluate(() => {
    const fakeStream = {
      getTracks: () => [{ stop: () => {} }]
    }
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream,
        enumerateDevices: async () => [
          { kind: 'audioinput', deviceId: 'default', label: 'Default Mic', groupId: 'g1' }
        ]
      }
    })
  })
  await clickNext(page) // → step 2
  await page.waitForSelector('[data-testid="onboarding-step-mic"]', { timeout: 5000 })
  await page.getByRole('button', { name: /Permitir acesso ao microfone/i }).click()
  await page.waitForTimeout(300)
  await clickNext(page) // → step 3
  await page.waitForSelector('[data-testid="onboarding-step-hotkey"]', { timeout: 5000 })
  await page.waitForTimeout(220)
  await shoot(page, 'wo5-step3-hotkey')
  await page.close()
}

// Helper: progresses from step1 to step4 with mic mock; provider mock varies.
async function gotoStep4(fills) {
  const page = await openWizard({ fills })
  await page.evaluate(() => {
    const fakeStream = {
      getTracks: () => [{ stop: () => {} }]
    }
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream,
        enumerateDevices: async () => [
          { kind: 'audioinput', deviceId: 'default', label: 'Default Mic', groupId: 'g1' }
        ]
      }
    })
  })
  await clickNext(page) // → step 2
  await page.waitForSelector('[data-testid="onboarding-step-mic"]', { timeout: 5000 })
  await page.getByRole('button', { name: /Permitir acesso ao microfone/i }).click()
  await page.waitForTimeout(280)
  await clickNext(page) // → step 3
  await page.waitForSelector('[data-testid="onboarding-step-hotkey"]', { timeout: 5000 })
  await page.waitForTimeout(180)
  await clickNext(page) // → step 4
  await page.waitForSelector('[data-testid="onboarding-step-test"]', { timeout: 5000 })
  return page
}

// ── Step 4 — State A: empty (no key cadastrada) ────────────────────
{
  const page = await gotoStep4([])
  await page.waitForTimeout(300)
  await shoot(page, 'wo5-step4-test-empty')
  await page.close()
}

// ── Step 4 — State B: key cadastrada, ready to record ───────────────
{
  const page = await gotoStep4([
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
  await page.waitForTimeout(300)
  await shoot(page, 'wo5-step4-test-ready')

  // Click "gravar 5s e testar" — falls into demo mode (no bridge).
  await page.getByRole('button', { name: /gravar 5s e testar/i }).click()
  // Wait for success state: latency text appears.
  await page.waitForFunction(
    () => /Latência:/i.test(document.body.innerText),
    { timeout: 6000 }
  )
  await page.waitForTimeout(200)
  await shoot(page, 'wo5-step4-test-success')
  await page.close()
}

await browser.close()
server.close()

if (errors.length > 0) {
  console.error('\n=== AUDIT FAILURES ===')
  for (const e of errors) console.error('  -', e)
  process.exit(1)
}

console.log('\n=== AUDIT PASS ===')
console.log(`screenshots: ${OUT_DIR}`)
