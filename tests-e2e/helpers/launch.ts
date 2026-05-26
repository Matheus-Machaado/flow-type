/**
 * Helpers to launch the built Flow Type Electron app for E2E tests.
 *
 * Each spec calls `launchFlowtype()` to get a fresh app + userData dir under
 * `tests-e2e/tmp/<spec-name>/`. The directory is wiped on launch so seed
 * data (settings.first_run_completed, vocab entries, transcriptions) is
 * deterministic.
 *
 * Real STT cascade and text injection are NOT exercised here — they require
 * a Windows session with audio + foreground-window APIs. We test:
 *
 *   - Renderer loading (history view, settings view, vocab view, overlay)
 *   - IPC channels exposed via window.flowtype.*
 *   - Overlay state cycle (idle → armed → capturing → processing → idle)
 *   - Repos round-tripping data the renderer reads back
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..', '..')
const mainEntry = join(projectRoot, 'out', 'main', 'index.js')

export interface LaunchOptions {
  /** Subdir under tests-e2e/tmp/ — defaults to the calling spec's test title. */
  dataDirName: string
  /** Pre-seed env vars (Groq keys, force-local, etc). */
  env?: Record<string, string>
  /** If true, do NOT wipe the userData dir on launch (reuse state). */
  preserveState?: boolean
}

export interface LaunchedApp {
  app: ElectronApplication
  /** First non-overlay BrowserWindow (the main window, hidden by default — surfaced via app.showMain()). */
  mainPage: Page | null
  dataDir: string
  close(): Promise<void>
}

const tmpRoot = join(projectRoot, 'tests-e2e', 'tmp')

export async function launchFlowtype(opts: LaunchOptions): Promise<LaunchedApp> {
  if (!existsSync(mainEntry)) {
    throw new Error(
      `launchFlowtype: ${mainEntry} not found — run \`npm run build\` first.`
    )
  }

  if (!existsSync(tmpRoot)) mkdirSync(tmpRoot, { recursive: true })
  // For preserve-state runs we use the literal name (second launch of the
  // same spec needs the same dir). For fresh runs we tack on a stamp so a
  // previous run leaking file locks (common on Windows when an Electron
  // child process hangs on to log files past graceful close) doesn't crash
  // the next launch with EPERM.
  const stamp = opts.preserveState
    ? ''
    : '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const dataDir = join(tmpRoot, opts.dataDirName + stamp)
  if (!opts.preserveState && existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // Windows file lock — fall through; mkdir below tolerates existing dirs.
    }
  }
  mkdirSync(dataDir, { recursive: true })

  // Strip ELECTRON_RUN_AS_NODE — if the shell session has it set
  // (so-testar harness exports it), Electron skips the Chromium main process
  // and runs the entry as a regular Node script, which crashes because
  // `require('electron')` returns the binary path string instead of the API
  // object.
  const baseEnv: Record<string, string> = { ...process.env } as Record<string, string>
  delete baseEnv.ELECTRON_RUN_AS_NODE

  const env: Record<string, string> = {
    ...baseEnv,
    // Force the app to use isolated userData + DB locations so specs cannot
    // pollute the real install.
    FLOWTYPE_DATA_DIR: dataDir,
    FLOWTYPE_DB_PATH: join(dataDir, 'db.sqlite'),
    // Skip the Right Ctrl uIOhook listener — the test machine probably has
    // no native hook permission and it spams the host's foreground app.
    FLOWTYPE_DISABLE_HOTKEY: '1',
    // Disable nut.js paste path — keystroke synthesis on CI is destructive.
    FLOWTYPE_DISABLE_INJECTION: '1',
    ...(opts.env ?? {})
  }

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: projectRoot,
    env,
    timeout: 20_000
  })

  // Wait for the first window to be created (overlay or main — whichever).
  // BrowserWindow.getAllWindows() returns 0 immediately after launch; we
  // need at least one ready page to drive IPC.
  const firstPage = await app.firstWindow({ timeout: 10_000 }).catch(() => null)

  // Try to surface the main window for the React UI tests. If it fails,
  // specs that need the main page will fall back to firstPage.
  try {
    await app.evaluate(async ({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows()
      const main = wins.find(
        (w) => !w.webContents.getURL().includes('overlay')
      )
      main?.show()
    })
  } catch {
    // ignore
  }

  // Allow a moment for the main window's preload + React to finish loading
  // so `window.flowtype` exists when the spec calls it.
  await new Promise((r) => setTimeout(r, 500))

  let mainPage: Page | null = null
  const pages = app.windows()
  for (const p of pages) {
    const url = p.url()
    if (!url.includes('overlay')) {
      mainPage = p
      break
    }
  }
  if (!mainPage) mainPage = firstPage

  return {
    app,
    mainPage,
    dataDir,
    async close() {
      // The app intercepts BrowserWindow close to minimize to tray, so
      // Playwright's gentle `app.close()` (which calls app.quit through the
      // electron handle) ends up hanging on the tray loop. We force a hard
      // process exit via the inspector handle instead — same effect as the
      // tray "Sair" item, no GUI dependency.
      try {
        await app.evaluate(async ({ app: a }) => {
          // app.exit() bypasses the will-quit/close hooks and exits with code 0.
          a.exit(0)
        })
      } catch {
        // ignore — inspector may already be gone
      }
      try {
        await app.close()
      } catch {
        // ignore — process may already be down
      }
    }
  }
}

/**
 * Convenience: invoke an IPC channel from the main process side. Useful for
 * specs that need to seed state without going through the UI.
 */
export async function invokeIpc<T = unknown>(
  app: ElectronApplication,
  channel: string,
  ...args: unknown[]
): Promise<T> {
  return app.evaluate(
    async ({ ipcMain }, payload: { channel: string; args: unknown[] }) => {
      // We can't directly call handlers, but we can emit through a hidden
      // WebContents. Workaround: read a known handler via internal map.
      // This is intentionally fragile — kept here only as a stub. Specs
      // prefer driving via `page.evaluate(() => window.flowtype.X())`.
      void ipcMain
      throw new Error(
        `invokeIpc(${payload.channel}): not implemented — use page.evaluate(() => window.flowtype...) instead`
      )
    },
    { channel, args }
  )
}
