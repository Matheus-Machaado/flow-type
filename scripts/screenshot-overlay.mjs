/**
 * Screenshots the 4 overlay states by serving the built renderer over a
 * loopback HTTP server and driving Playwright (chromium) against each
 * `?state=...` URL.
 *
 * Outputs to .studio/screenshots/flowtype/<YYYY-MM-DD-impl>/.
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const ROOT = resolve(process.cwd(), 'out/renderer')
const OUT_DIR = resolve(process.cwd(), '../../.studio/screenshots/flowtype/2026-05-25-impl')
const PORT = 5673

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
  viewport: { width: 200, height: 64 },
  deviceScaleFactor: 2 // crisper screenshots
})

const states = ['idle', 'armed', 'capturing', 'processing']
for (const s of states) {
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/overlay.html?state=${s}`)
  // Give the React app time to mount + the waveform a beat to animate.
  await page.waitForTimeout(600)
  const file = join(OUT_DIR, `wo1-overlay-${s}.png`)
  await page.screenshot({ path: file, omitBackground: false })
  console.log('wrote', file)
  await page.close()
}

// Bonus: a screenshot of the main window placeholder.
const mainPage = await ctx.newPage()
await mainPage.setViewportSize({ width: 480, height: 720 })
await mainPage.goto(`http://127.0.0.1:${PORT}/index.html`)
await mainPage.waitForTimeout(400)
await mainPage.screenshot({ path: join(OUT_DIR, 'wo1-main-window.png') })
console.log('wrote main window screenshot')

await browser.close()
server.close()
console.log('done')
