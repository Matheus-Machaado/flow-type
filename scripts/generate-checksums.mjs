#!/usr/bin/env node
/**
 * Generate SHA-256 checksums for every artefact in dist-installer/ and write
 * them to dist-installer/checksums.txt — the same file the site CTA links to.
 *
 * Output format mirrors the GNU `sha256sum` convention so users can verify
 * with `Get-FileHash -Algorithm SHA256 <file>` on Windows or `sha256sum -c`
 * elsewhere.
 */

import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(__dirname, '..')
const distDir = join(projectRoot, 'dist-installer')

if (!existsSync(distDir)) {
  console.error(`[checksums] no dist-installer/ found at ${distDir} — did you run \`npm run dist\`?`)
  process.exit(1)
}

/** @param {string} file */
async function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

const entries = readdirSync(distDir)
  .map((name) => ({ name, full: join(distDir, name) }))
  .filter((e) => {
    if (!statSync(e.full).isFile()) return false
    if (e.name === 'checksums.txt') return false
    // electron-builder yml side files (.blockmap, builder-effective-config.yaml)
    // are useful only when auto-update is enabled; skip them in v0.1.
    if (e.name.endsWith('.blockmap')) return false
    if (e.name.endsWith('.yaml') || e.name.endsWith('.yml')) return false
    return /\.(exe|zip|7z|msi)$/i.test(e.name)
  })

if (entries.length === 0) {
  console.error('[checksums] no installer artefacts found — nothing to hash')
  process.exit(1)
}

const lines = []
for (const entry of entries) {
  const hex = await sha256(entry.full)
  const size = statSync(entry.full).size
  console.log(`[checksums] ${entry.name} (${(size / 1024 / 1024).toFixed(1)} MiB) — ${hex}`)
  lines.push(`${hex}  ${entry.name}`)
}

const out = join(distDir, 'checksums.txt')
writeFileSync(out, lines.join('\n') + '\n', 'utf-8')
console.log(`[checksums] wrote ${relative(projectRoot, out)} (${entries.length} entries)`)
