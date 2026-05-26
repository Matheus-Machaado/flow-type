#!/usr/bin/env node
/**
 * Generate dist-installer/RELEASE_NOTES.md from package.json + a curated
 * v0.1.0 template. If git is available, append the abbreviated short-log
 * of the last 50 commits as "What changed".
 *
 * This is deterministic input for the GitHub release body — the owner can
 * edit it manually before publishing.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))

const distDir = join(projectRoot, 'dist-installer')
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

let gitLog = ''
try {
  gitLog = execSync('git log --oneline -50 --no-decorate', {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'ignore']
  }).toString().trim()
} catch {
  gitLog = '_git log unavailable_'
}

const notes = `# Flow Type v${pkg.version}

Dictation universal Windows — your voice becomes text in any app, with no token limits.

## Downloads

| Artefact | Notes |
|----------|-------|
| \`Flow Type Setup ${pkg.version}.exe\` | NSIS installer, lets you choose install dir. Per-user install (no admin needed). |
| \`Flow Type-${pkg.version}-x64-portable.exe\` | Portable single-file executable. |
| \`checksums.txt\` | SHA-256 of every artefact above. |

> **SmartScreen note:** v0.1 is unsigned. Windows may show "publisher unknown" — click **More info → Run anyway**. Code signing is on the roadmap.

## What's in v0.1

- Hold **Right Ctrl** to dictate; release to paste the transcribed text wherever your cursor is.
- Cloud transcription via Groq Whisper Large v3 Turbo (free tier; bring your own key).
- Local fallback via faster-whisper (downloaded on first use).
- Custom vocabulary corrections applied post-STT.
- Searchable history (FTS5), editable, exportable.
- Pool of up to 3 Groq keys for resilience (UI reveals slots progressively).

## Known limitations

- Windows only (10+, x64).
- Some password fields and certain Electron apps may intercept Ctrl+V — use the typing fallback whitelist in Settings.
- faster-whisper local model (~140 MB) is downloaded on first use, not bundled.
- No auto-update. Re-download from the site to upgrade.

## Privacy

- Audio is processed in-memory only; the raw recording is never stored unless you enable "Keep audio for replay" in Settings.
- When the cloud cascade succeeds, the audio buffer is sent to Groq and discarded.
- When the local fallback runs, nothing leaves your machine.

## Verifying the download

\`\`\`powershell
Get-FileHash -Algorithm SHA256 .\\Flow_Type_Setup_${pkg.version}.exe
\`\`\`

Compare the hash to the line in \`checksums.txt\`.

## Recent commits

\`\`\`
${gitLog}
\`\`\`
`

const out = join(distDir, 'RELEASE_NOTES.md')
writeFileSync(out, notes, 'utf-8')
console.log(`[release-notes] wrote ${out}`)
