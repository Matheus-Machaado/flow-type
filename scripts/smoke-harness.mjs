#!/usr/bin/env node
/**
 * Smoke-test harness — prints a check-off list for the 7-app manual smoke
 * (Claude.ai, ChatGPT, Notepad, WhatsApp Web, VSCode, Slack, Cmd Prompt)
 * and writes a fillable Markdown template to dist-installer/SMOKE_RESULTS.md.
 *
 * Run after `npm run dist`, then open the .md, dictate one short phrase per
 * app, tick the boxes, and attach the file to the GitHub release.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(__dirname, '..')
const distDir = join(projectRoot, 'dist-installer')
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

const apps = [
  {
    id: 1,
    name: 'Claude.ai (Chrome)',
    setup: 'Open https://claude.ai in Chrome, focus the chat input.',
    phrase: '"olá Claude, isto é um teste"',
    checks: ['Text appeared', 'No duplicated characters', 'No focus loss']
  },
  {
    id: 2,
    name: 'ChatGPT (Chrome)',
    setup: 'Open https://chat.openai.com, focus the prompt textarea.',
    phrase: '"smoke test 5 testando"',
    checks: ['Text appeared', 'No duplicated characters', 'No focus loss']
  },
  {
    id: 3,
    name: 'Notepad (native)',
    setup: 'Open Notepad (Win+R notepad), focus the document.',
    phrase: '"linha um teste flow type"',
    checks: ['Text appeared', 'No clipboard residue', 'Cursor advanced']
  },
  {
    id: 4,
    name: 'WhatsApp Web (Chrome)',
    setup: 'Open https://web.whatsapp.com, focus a chat message field. Do NOT press Enter.',
    phrase: '"oi tudo bem"',
    checks: ['Text appeared in input', 'No accidental send', 'Emoji-free output']
  },
  {
    id: 5,
    name: 'VSCode',
    setup: 'Open VSCode, focus an editor pane on an empty .txt file.',
    phrase: '"function transcribe audio buffer"',
    checks: ['Text appeared', 'No autocomplete interference', 'No keystroke dropped']
  },
  {
    id: 6,
    name: 'Slack (desktop or web)',
    setup: 'Open Slack, focus the message composer of any channel. Do NOT press Enter.',
    phrase: '"reuni o time amanhã às nove"',
    checks: ['Text appeared in composer', 'No accidental send', 'No focus loss']
  },
  {
    id: 7,
    name: 'Command Prompt (cmd.exe)',
    setup: 'Open cmd.exe, sit at the prompt. Backspace-clear before submitting.',
    phrase: '"echo hello"',
    checks: ['Text appeared at prompt', 'No control characters', 'Backspace cleans up']
  }
]

const lines = []
lines.push('# Flow Type v0.1.0 — Manual Smoke Results')
lines.push('')
lines.push(`Filled by: _____________________  Date: ${new Date().toISOString().slice(0, 10)}`)
lines.push('')
lines.push('Hardware: ______________________  OS build: ____________________')
lines.push('')
lines.push('Provider used during smoke: [ ] Groq cloud  [ ] Local fallback  [ ] Both')
lines.push('')
lines.push('Hotkey under test: __________________  (default: Right Ctrl, hold to record)')
lines.push('')
lines.push('---')

for (const app of apps) {
  lines.push('')
  lines.push(`## ${app.id}. ${app.name}`)
  lines.push('')
  lines.push(`Setup: ${app.setup}`)
  lines.push('')
  lines.push(`Phrase: ${app.phrase}`)
  lines.push('')
  for (const c of app.checks) {
    lines.push(`- [ ] ${c}`)
  }
  lines.push('')
  lines.push('Notes: ____________________________________________________________')
}

lines.push('')
lines.push('---')
lines.push('')
lines.push('## Overall verdict')
lines.push('')
lines.push('- [ ] Release-grade (all 7 apps OK)')
lines.push('- [ ] Release with caveats (list which apps failed below)')
lines.push('- [ ] Block release (critical apps failing — fix and re-smoke)')
lines.push('')
lines.push('Caveats / blockers: ____________________________________________________')
lines.push('')

const out = join(distDir, 'SMOKE_RESULTS.md')
writeFileSync(out, lines.join('\n'), 'utf-8')

console.log('\n=== Flow Type smoke harness ===')
console.log(`Template written to: ${out}`)
console.log('\nManual steps:')
for (const app of apps) {
  console.log(`  ${app.id}. ${app.name} — ${app.phrase}`)
}
console.log('\nWalkthrough:')
console.log('  1. Install Flow Type from dist-installer/ (NSIS .exe or portable .zip).')
console.log('  2. Configure at least one Groq key in Settings (or rely on local fallback).')
console.log('  3. For each app above: open it, focus the input, hold Right Ctrl, speak the phrase, release.')
console.log('  4. Tick the boxes in the markdown template as you go.')
console.log('  5. Commit the filled template along with the release artefacts.')
