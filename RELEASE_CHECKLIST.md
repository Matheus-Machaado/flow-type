# Flow Type v0.1.0 — Release Checklist

> Checklist final pro release v0.1.0 (gerado por Roberto WO-8). Marque conforme valida.

## Quality gates (CI-friendly — Roberto verificou)

- [x] **Unit tests** — `npm run test` → **171/171 passando** (vitest, 20 suites: WO-6 SQLite + WO-2 STT + WO-3 injection)
- [x] **E2E tests** — `npm run test:e2e` → **6/7 passing + 1 skipped** (happy-path Groq / fallback local / vocab correction / overlay 4 states / histórico replay+edit / perf-gate; onboarding-first-run skipped — pode habilitar agora que WO-5 chegou)
- [x] **Performance gate** — p50 = 837ms, p95 = 841ms, p99 = 841ms (alvo p50 < 1500ms → **PASS**)
- [x] **Lighthouse site** — perf=100, a11y=96, best-practices=100, seo=100 (alvo ≥95 em todas → **PASS** com folga)
- [x] **Build dev** — `npm run build` → main 119KB + renderer 155KB, sem erro
- [x] **Typecheck** — `npm run typecheck` → zero erros

## Build artefatos (requer ambiente Windows com MSVC + Python pra rebuild nativos)

- [ ] **`npm run dist`** local em máquina Windows do owner
  - Gera `dist-installer/Flow Type Setup 0.1.0.exe` (NSIS)
  - Gera `dist-installer/Flow Type-0.1.0-portable.zip`
  - Gera `dist-installer/checksums.txt` (SHA-256 dos 2 artefatos via `scripts/generate-checksums.mjs`)
  - Gera `dist-installer/RELEASE_NOTES.md` (via `scripts/generate-release-notes.mjs`)

> ⚠️ **Roberto NÃO conseguiu rodar `npm run dist` em sandbox** porque o ambiente não tem Windows MSVC + Python pra recompilar `uiohook-napi`/`better-sqlite3`/`nut.js` nativos. Owner roda local: `cd projects/flowtype && npm run dist`.

## Smoke manual (owner — 5-10min)

- [ ] **`npm run dev`** abre Electron → tray icon aparece → main window NÃO aparece (correto)
- [ ] Hold Right Ctrl em qualquer app → overlay vai idle → armed → (fala algo) → capturing → processing → texto colado no campo
- [ ] **`npm run smoke`** abre instruções pros 7 apps:
  - [ ] Claude.ai (Chrome)
  - [ ] ChatGPT (Chrome)
  - [ ] Notepad (nativo Windows)
  - [ ] WhatsApp Web (Chrome)
  - [ ] VSCode
  - [ ] Slack (desktop)
  - [ ] Cmd Prompt
- [ ] Preencher `dist-installer/SMOKE_RESULTS.md` com check-off

## Pendências operacionais externas (owner)

- [ ] **Comprar domínio** `flowtype.app` (~$10/ano — Cloudflare Registrar ou Namecheap)
- [ ] **Cloudflare Pages project** criado e DNS apontando — usar prompt copy-paste em [projects/flowtype/site/DEPLOY.md](site/DEPLOY.md) seção "Prompt pro Claude Chrome"
- [ ] **GitHub repo** `flowtypeapp/flowtype` criado (público, MIT license)
- [ ] **Push código** + criar tag `v0.1.0`
- [ ] **GitHub Releases** — upload `.exe` + `.zip` + `checksums.txt` + `RELEASE_NOTES.md`
- [ ] **Substituir placeholders no site** após release:
  - `github.com/flowtypeapp/flowtype` (3 ocorrências em Footer.astro + Header.astro + FAQ.astro) → URL real do repo
  - `/download/flowtype-setup-v0.1.0.exe` + `/download/flowtype-portable-v0.1.0.zip` → GitHub Releases URLs reais
  - `checksums.txt` com SHA-256 reais (botão "Copiar SHA-256" do DownloadCTA)
  - Email `hello@flowtype.app` em Footer → email real ou remover
- [ ] **Comprar Groq key** dedicada de produção (não usar a key de dev) se quiser separar tracking

## Quando publicar (rodada pós-release)

- [ ] Habilitar code signing (EV cert ~$500/ano) — elimina SmartScreen warning
- [ ] Auto-update via electron-updater + GitHub Releases
- [ ] macOS build (precisa Accessibility API pra text injection)
- [ ] Linux build (X11 primeiro; Wayland depois)
- [ ] Bundle faster-whisper small.en automático (vs CTA "Detectar e baixar" atual)

## Reports gerados (artifacts de QA)

- `projects/flowtype/test-results/e2e-report.json` — 7 specs, 6 passed + 1 skipped, 35s total
- `projects/flowtype/test-results/perf-report.json` — 20 samples, p50=837ms
- `projects/flowtype/site/lighthouse-report.html` — abra no browser pra ver detalhado
- `projects/flowtype/site/lighthouse-report.json` — raw scores
