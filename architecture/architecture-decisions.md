# flowtype — Architecture Decisions (ADRs)

> 16 ADRs documentando decisões de stack, arquitetura e trade-offs feitos no intake
> (MIS-0024) e refinados no design. Cada ADR: **Contexto / Decisão / Alternativas
> consideradas / Consequências**. Aprovado em 2026-05-25.

---

## ADR-01 — Stack: Electron + TS + React + electron-vite

**Status:** Accepted
**Data:** 2026-05-25

**Contexto:** v0.1 é Windows-first, com forte demanda de injeção de texto cross-app, hotkey global hold/release, mic capture, overlay always-on-top e bundle de binário Python (faster-whisper). Owner já tem playspeak rodando com Electron, com pipeline mic + STT validado em produção.

**Decisão:** Electron 33 + TypeScript + React 19 + electron-vite + Tailwind 4. Framer Motion pra animações de overlay e settings. Toolchain idêntico ao playspeak.

**Alternativas consideradas:**

- **Tauri 2 (Rust + WebView):** bundle final ~50MB vs Electron ~300MB; security-by-default melhor. Rejeitado por (a) reescrita do shell + IPC + bindings nativos sob nova superfície sem reuso direto do playspeak; (b) ecossistema de bindings audio/global-hotkey/clipboard cross-app no Rust ainda imaturo no Windows (uIOhook, nut.js só existem em Node); (c) faster-whisper child Python exige mais boilerplate em Rust.
- **C# WPF / WinUI:** performance e integração Windows ótimas, mas custo de UI animada (overlay 4 estados, dark luxuoso) e DX de prototipação inviável dentro do escopo de 3M tokens e prazo curto.
- **Web app + PWA:** descartado de cara — não pode hotkey global, não pode injetar texto em apps nativos, não pode tray.

**Consequências:**

- Bundle ~250-300MB (faster-whisper small.en + Python binary + uIOhook + nut.js + ffmpeg-static dominam o peso). Aceitável v0.1.
- Code signing **diferido** (v0.1 publica sem assinatura — SmartScreen warning aceito, igual playspeak). Registrado em ADR-15.
- Reuso direto do shell/Vite/Tailwind config do playspeak acelera onboarding de Neymar.

---

## ADR-02 — Main grosso, renderer fino (lógica sensível no main process)

**Status:** Accepted

**Contexto:** Renderer com `contextIsolation: true` (default Electron) é a única configuração segura — sem `nodeIntegration`. STT keys (Groq) e operações de FS, DB, child_process, nut.js, uIOhook não podem viver no renderer por princípio.

**Decisão:** Toda lógica que toca segredos (Groq keys), file system, DB, native bindings, ou child processes (Python faster-whisper) vive no **main process**. Renderers (overlay, settings, history, onboarding) são UI-only + IPC tipada via preload com `contextBridge.exposeInMainWorld('flowtype', {...})`.

**Alternativas consideradas:**

- **Renderer com `nodeIntegration: true`:** rejeitado por security (Chromium memory dump em crash exporia keys).
- **Worker thread no main em vez de child Python:** rejeitado porque faster-whisper é Python (CTranslate2 + numpy + tokenizers); reescrever em JS/Wasm fora do escopo.

**Consequências:**

- Tipos compartilhados em `packages/shared/{ipc-types,schemas,errors}.ts` consumidos por main + renderers.
- Toda interação UI ↔ DB/STT vai via IPC (~1-5ms overhead, irrelevante).
- ~40 canais IPC no total (ver `internal-contracts.md` §1). Surface grande mas tipada.

---

## ADR-03 — better-sqlite3 (sync) sobre node-sqlite3 (async)

**Status:** Accepted

**Contexto:** App escreve em DB a cada hotkey-release (1 row transcription + 1 row token_usage upsert + N updates vocab.times_applied). Leituras de histórico/settings também frequentes. Volume previsto: < 50 MB em 90 dias.

**Decisão:** `better-sqlite3` (sync, native binding). Operações DB no main process são síncronas.

**Alternativas consideradas:**

- **node-sqlite3 (async):** API Promise-based mais "natural" em JS moderno, mas 3-5x mais lenta em writes pequenos típicos, sem ganho real porque renderer já chama via IPC async.
- **Drizzle / Prisma ORM:** overhead de runtime + complexidade para um schema simples (6 tabelas). Rejeitado por overkill.

**Consequências:**

- API simples, type-safe, statements preparados em construtor (`db.prepare('...')`).
- Queries grandes podem bloquear main thread. Mitigação: paginação no histórico (e4-history-window-timeline: limit 50, virtual scrolling), índices corretos (idx_transcription_ts, idx_transcription_app_exe, idx_token_usage_provider_day).
- Migration runner também sync, executa antes de qualquer outra operação.

---

## ADR-04 — Groq cloud primário; local-first explícito como opt-in

**Status:** Accepted

**Contexto:** Wispr Flow se vende por velocidade (sub-1s). Owner usa Wispr exatamente por isso. Trocar primary pra local (faster-whisper small.en em CPU típica ~3-4s) quebra a promessa de produto e perde o diferencial.

**Decisão:** **Velocidade primeiro.** Cascade default = `Groq pool → faster-whisper local`. Settings/STT expõe toggle `stt_force_local` pra usuários que priorizam privacy (default OFF).

**Alternativas consideradas:**

- **Local-first com Groq opcional:** rejeitado por quebrar diferencial vs Wispr — usuário sairia decepcionado nos primeiros segundos.
- **Auto-detect (offline → local, online → cloud):** rejeitado porque não cobre o caso de "online mas Groq sem cota" — cascade do nível 1 (rotação intra-Groq) lida com isso de forma mais granular.

**Consequências:**

- Privacy fica documentado no FAQ do site (e7-site-faq) — usuário sensível ativa `stt_force_local` em 1 click em Settings.
- Local SEMPRE bundled (~140MB do small.en), pra fallback offline existir sem internet.
- Latência alvo do gate de release (e8-perf-gate-p50): p50 < 1500ms hotkey→paste com Groq.

---

## ADR-05 — Pool multi-key Groq (até 3 slots) com round-robin + reset diário

**Status:** Accepted (CR-1 do intake, request explícito do owner)
**Data:** 2026-05-25 (CR-1)

**Contexto:** Free tier Groq = 14.4k req/dia POR KEY. Owner pode criar até 3 keys legítimas em contas diferentes. Padrão multi-key já validado em playspeak (Gemini + Groq pools). CR-1 do intake formalizou que flowtype espelha esse padrão.

**Decisão:** Classe `GroqKeyPool` gerencia 3 slots fixos (indexados 0/1/2). Algoritmo:

1. `next()`: round-robin pelo ponteiro `nextSlotIndex`, skipando `invalid` e `exhausted`. Tie-breaker: menor `slotIndex`.
2. `markExhausted(i)`: status → 'exhausted'; persiste em `token_usage.marked_exhausted_at`. Volta online em `resetDaily()`.
3. `markInvalid(i)`: status → 'invalid'; persiste em `token_usage.marked_invalid_at` (cross-day). NÃO volta online sozinho — exige re-validação manual em Settings.
4. `resetDaily()`: cron 00:00 UTC + boot-check (se `lastReset > 24h`); zera `usedToday`, limpa `exhausted` (mantém `invalid`).

**Alternativas consideradas:**

- **Single key + retry exponencial:** rejeitado pelo owner explicitamente (CR-1). Triplica quota e dá resiliência a uma key revogada/inválida.
- **Pool dinâmico N slots:** rejeitado por complicar UI sem benefício real — owner não precisa de mais de 3 contas legítimas.
- **Distribuir por menor `usedToday` (load balancing inteligente):** rejeitado por overkill — round-robin já distribui uniformemente (após M calls, |used[i] - used[j]| ≤ 1 entre slots online).

**Consequências:**

- Schema SQLite tem `token_usage` (UNIQUE provider/slot/day) + `groq_slot_meta` (3 rows fixas). Estado persiste cross-restart.
- UI Settings/STT renderiza 3 cards `<GroqSlotManager>` reutilizado em Onboarding step 4 (modo compact).
- Bootstrap lê `GROQ_API_KEY`, `GROQ_API_KEY_2`, `GROQ_API_KEY_3` + `LABEL_{1,2,3}` de `secrets.env`.

---

## ADR-06 — Cascade STT em 2 níveis (rotação intra-Groq → fallback local)

**Status:** Accepted

**Contexto:** Com o pool de 3 keys (ADR-05), cascade fica 2-nível em vez do clássico 1-nível flat. Owner espera (e CR-1 confirma) que falhas DENTRO do Groq (429/401) NÃO derrubem imediatamente pra local — devem tentar outro slot primeiro.

**Decisão:** `SttGateway.transcribe()` executa cascade ordenada:

- **Nível 1 (intra-Groq, mesmo turno):** while `pool.onlineCount() > 0`: tenta próximo slot. 429 → `markExhausted` + próximo. 401 → `markInvalid` + próximo. Timeout 1x → retry mesmo slot. Timeout 2x → cai pro nível 2 sem marcar exhausted.
- **Nível 2 (fallback de provider):** só dispara quando `pool.allUnavailable()` OU timeout repetido OU `GroqOfflineError`. Roda `faster-whisper local`.
- Flag `settings.stt_force_local=true` pula nível 1 inteiro.

**Alternativas consideradas:**

- **Cascade flat (qualquer falha Groq → local imediato):** rejeitado por desperdiçar slots disponíveis e degradar latência ~3-4x desnecessariamente.
- **Cascade 3-nível com outro cloud (ex.: Deepgram):** rejeitado por escopo — v0.1 fica com Groq + local. Pode entrar em rodada futura.

**Consequências:**

- Telemetria captura `key_rotation_count` + `attempts[]` em cada CascadeResult, registrado em `transcription.vocab_corrections_applied` e log estruturado `groq.rotation`.
- Overlay badge (e2-provider-badge-overlay) mostra qual slot/provider rodou — feedback visual imediato.

---

## ADR-07 — faster-whisper (Python child) vs whisper.cpp (native node binding)

**Status:** Accepted (herdado do playspeak)

**Contexto:** Local STT precisa rodar em CPU típica (4 cores, 8-16 GB RAM) com latência aceitável (~3-4s) pra áudio de 3s, com modelo pequeno (small.en ~140MB).

**Decisão:** `faster-whisper` (Python, baseado em CTranslate2) rodando em child process persistente (warm — vive entre transcrições). Binary standalone via PyInstaller, bundled em `resources/binaries/whisper.exe`.

**Alternativas consideradas:**

- **whisper.cpp + node binding (smart-whisper, nodejs-whisper):** single binary ~50MB, sem Python. Rejeitado porque (a) latência 2-4x maior que faster-whisper em pt/en com small model em CPU; (b) API menos flexível pra streaming de áudio; (c) playspeak já validou o caminho Python child, reuso direto.
- **WebAssembly Whisper (whisper-wasm):** rejeitado porque roda no renderer com payload ~80MB descompactado + perf pior que native; e queremos lógica no main (ADR-02).
- **Cloud-only sem local fallback:** rejeitado — privacy mode (ADR-04 toggle) e modo offline são requisitos.

**Consequências:**

- Bundle inclui ~80MB de Python runtime + ~140MB de small.en model. Total `resources/` ≈ 220MB. Aceitável (instalador alvo < 300MB total).
- Child process precisa de health-check + auto-restart (se morrer, próximo request restart). Implementado em `LocalSttManager`.
- Modelo bundled = `small.en`. v0.1 não troca modelo em runtime (fica em rodada futura: Settings/STT permitiria escolher tiny/base/small/medium pra trade-off velocidade/qualidade).

---

## ADR-08 — Clipboard paste pattern (não typing simulation) como caminho padrão

**Status:** Accepted

**Contexto:** Injeção de texto cross-app em Windows tem dois caminhos viáveis: (a) clipboard + Ctrl+V, (b) typing simulado char-por-char. Ambos têm trade-offs.

**Decisão:** **Clipboard paste pattern** como default. Pipeline: snapshot clipboard → write transcrição → simular Ctrl+V → setTimeout 200ms → restore clipboard original.

**Alternativas consideradas:**

- **Typing simulation default:** lento (~8ms/char × 200 chars = 1.6s), perde caracteres especiais em alguns apps (acentos), e cada keystroke vira event individual no app alvo (pode disparar autocomplete intrusivo). Rejeitado.
- **Windows SendInput API direto (sem clipboard):** mais "limpo" mas reimplementaria nut.js do zero em Node native addon. Rejeitado por escopo.

**Consequências:**

- Snapshot + restore preserva clipboard do user (não destrói o que ele tinha copiado).
- Alguns apps bloqueiam paste (campos de senha, alguns terminais). **Fallback typing** por blacklist editável em Settings (ADR-09).
- Latência adicional ~80-200ms (sleep entre press/release + restore delay). Cabe no orçamento p50 < 1500ms.

---

## ADR-09 — nut.js pra Ctrl+V simulation + typing fallback

**Status:** Accepted

**Contexto:** Precisa de lib Node pra simular keypress global em Windows. Opções: `nut.js` (full stack input/screen), `node-key-sender` (Java JAR), `robotjs` (deprecated em Node moderno).

**Decisão:** `nut-js` (npm `@nut-tree-fork/nut-js` ou maintained equivalent). Cobre keypress, mouse, screen — usaremos só keyboard v0.1.

**Alternativas consideradas:**

- **node-key-sender:** depende de Java runtime no sistema do user — inaceitável.
- **robotjs:** abandonado, não compila em Node 20+ sem patches.
- **Windows SendInput via ffi-napi:** menor footprint, mas exige escrever bindings + manutenção; nut.js já encapsula isso testado.

**Consequências:**

- nut.js native binding bundled (small, <5MB).
- Antivírus pode flagrar nut.js como keylogger (risco documentado em BLK-RISK-001 do intake). Mitigação: documentar no FAQ + code signing futuro reduz alerts.
- Typing fallback (e3-typing-fallback) usa `nut.keyboard.type(text)` com delay 8ms/char — mesma lib, mesma manutenção.

---

## ADR-10 — uIOhook pra hold/release detection (Electron globalShortcut só dispara on press)

**Status:** Accepted

**Contexto:** Requisito do produto: hotkey hold/release (não toggle). Segura Right Ctrl = arma + grava; solta = encerra + dispara STT. Electron `globalShortcut.register` só dispara callback no press, sem evento de release.

**Decisão:** `uiohook-napi` (fork mantido de uIOhook). Listener de baixo nível em Windows captura keydown + keyup separadamente. Hold > 300ms (anti-tap acidental) confirma o "armed". Keyup dispara released.

**Alternativas consideradas:**

- **`node-global-key-listener`:** equivalente funcional, mas binding nativo menos maduro. Pode entrar como fallback futuro.
- **Polling com `globalShortcut` + timer:** rejeitado — workaround frágil que não detecta release real.
- **Raw Windows hooks via ffi-napi:** rejeitado por custo de manutenção.

**Consequências:**

- Bundle adiciona uiohook native binding (~2MB).
- Em alguns sistemas com keyboard layout customizado, pode haver edge case (testar no QA Roberto WO-8). Mitigação: settings permite trocar hotkey.
- Lock file pra evitar 2 instâncias do app brigando pelo hook (Electron `requestSingleInstanceLock`).

---

## ADR-11 — PowerShell GetForegroundWindow pra detecção de janela ativa

**Status:** Accepted

**Contexto:** Precisa saber qual janela tem foco AGORA pra (a) decidir blacklist/whitelist (ADR-08), (b) capturar hwnd pra refoco antes do paste (caso foco escape entre hotkey-released e paste). Latência alvo p95 < 100ms.

**Decisão:** Spawn `powershell.exe -NoProfile -Command '...'` rodando `Add-Type` inline com P/Invoke pra `user32.dll!GetForegroundWindow` + `GetWindowText` + `GetWindowThreadProcessId`. Cache curto (~100ms) pra evitar overhead em chamadas back-to-back.

**Alternativas consideradas:**

- **Windows API direto via `ffi-napi`/`node-ffi-napi`:** menor latência (~10ms vs ~50-80ms), mas binding nativo + maintenance cost. v0.1 prefere PowerShell já-instalado em todo Windows 10+.
- **active-win npm:** wrapper conveniente, mas internamente também spawn PowerShell + sem ganho real.
- **Electron `BrowserWindow.getFocusedWindow()`:** só funciona pra janelas do próprio app — inútil aqui.

**Consequências:**

- Latência aceitável p95 < 100ms (testado em playspeak via fluxo similar).
- Rodada futura pode trocar pra ffi-napi se perf gate (e8-perf-gate-p50) ficar apertado.
- Snapshot capturado no `hotkey:armed` é preservado e reusado no paste (mesmo se foco mudou) — refoco via `SetForegroundWindow(hwnd)` antes do Ctrl+V.

---

## ADR-12 — Groq keys em texto plano v0.1 (encryption diferido)

**Status:** Accepted

**Contexto:** Groq API keys são segredos. Idealmente armazenadas com `keytar` (Windows Credential Vault) ou `electron-store` com `safeStorage` (DPAPI). Implementação custa ~2-4h + branch de migration + testes em multiple Windows versions.

**Decisão:** v0.1 armazena keys em **texto plano** em:

- `%APPDATA%/flowtype/secrets.env` (prod) ou `.studio/local/flowtype-secrets.env` (dev) — gitignored.
- `groq_slot_meta.api_key_encrypted` (coluna chamada assim pra futura migração não-breaking; valor v0.1 é plaintext).

Filesystem permissions de `%APPDATA%/flowtype/` (per-user) são a barreira de segurança v0.1 — mesma postura do playspeak.

**Alternativas consideradas:**

- **keytar / electron safeStorage agora:** custo + risco de issues cross-version no Windows.
- **Web Crypto + senha mestra:** UX intrusiva (user digita senha em todo boot) sem ganho real.

**Consequências:**

- **Risco aceito:** malware com acesso ao home do user lê as keys. Mitigação: keys têm rate limit (Groq free 14.4k/dia/key) e podem ser revogadas via console.groq.com em segundos.
- Migration 0002_encrypt_keys.sql planejada (rodada futura) lê plaintext, encripta via `safeStorage`, regrava.
- Export de settings (e4 settings:export) **NUNCA inclui apiKey** — sinaliza presença mas obriga re-paste no import. Documentado em FAQ.

---

## ADR-13 — SQLite FTS5 pra busca de histórico

**Status:** Accepted

**Contexto:** Histórico cresce ~200 rows/dia × 90 dias = ~18k rows. Busca textual ("encontre 'reunião'") precisa ser sub-100ms.

**Decisão:** `transcription_fts` virtual table FTS5 com `content='transcription'`, tokenize `porter unicode61 remove_diacritics 2`. Triggers AFTER INSERT/UPDATE/DELETE sincronizam. Ranking via `bm25(transcription_fts)`. Search query JOIN com `transcription` pra retornar metadata + rank.

**Alternativas consideradas:**

- **Meilisearch local embedded:** overkill — adiciona binary 30+MB + processo separado. Justifica-se em datasets 1M+, não 18k.
- **`LIKE '%foo%'` simples:** O(n) full scan, sem ranking, sem diacritics-fold. Aceitável só pra protótipo.
- **In-memory index (lunr, fuse.js):** carregar tudo na RAM — funciona pra 18k mas escala ruim em sessões longas + indexação custosa.

**Consequências:**

- Triggers AFTER (não BEFORE) — ver `data-model.md` §transcription_fts pra justificativa.
- Suporta operadores FTS5 (frase `"foo bar"`, prefix `foo*`, NEAR/N) — útil pra power users.
- Tokenizer `remove_diacritics 2` resolve "reunião" matchar "reuniao".

---

## ADR-14 — Astro estático + Cloudflare Pages pro site (não Next.js)

**Status:** Accepted (alinhado com lesson do owner "stack default deploy")

**Contexto:** Site marketing é single-page com seções (hero, how-it-works, compare, features, screenshots, download, FAQ, footer). Sem auth, sem API, sem dados dinâmicos. Owner já usa Cloudflare Pages + Netlify como stack default.

**Decisão:** **Astro 4** estático, deploy Cloudflare Pages via push GitHub auto. Asset versioning `?v=COMMIT_SHA` em CSS/JS pra busting cache (lesson do owner). Headers `_headers` com `Cache-Control: max-age=31536000, immutable` em assets, `no-cache` em `index.html`.

**Alternativas consideradas:**

- **Next.js estático (`output: 'export'`):** funciona mas overkill — runtime React adiciona ~100KB JS desnecessário pra site puramente estático.
- **HTML+CSS puro:** funcionaria, mas Astro dá componentização de seções + ilhas opcionais de interatividade (FAQ accordion, lightbox) sem framework completo.
- **Vercel:** stack não-padrão do owner (lesson "stack default deploy"). Rejeitado.

**Consequências:**

- Build produz `dist/` puro estático, deploy direto sem SSR.
- Lighthouse LCP < 1500ms 3G (e7-site-hero-cta acceptance) facilmente atingível com Astro.
- Domínio `flowtype.app` ou subdomain a definir no release (e7-deploy-cf-pages-versioning).

---

## ADR-15 — electron-builder NSIS + portable .zip; code signing diferido v0.1

**Status:** Accepted (herdado do playspeak)

**Contexto:** Distribuição precisa ser .exe instalável e portable .zip. Code signing Windows custa ~$200-400/ano (cert OV/EV) — owner não vai pagar isso pra v0.1.

**Decisão:** `electron-builder` produz:

- `flowtype-setup-X.Y.Z.exe` (NSIS, perMachine=false, allowToChangeInstallationDirectory=true, oneClick=false). Default install em `%LOCALAPPDATA%/Programs/flowtype`.
- `flowtype-portable-X.Y.Z.zip` (rodável extraído sem install).

**Sem code signing v0.1.** SmartScreen warning "Windows protected your PC" aceito — user clica "Mais informações" → "Executar mesmo assim". FAQ explica isso.

**Auto-update desabilitado v0.1** (sem signing seria insecure).

**Alternativas consideradas:**

- **MSIX:** modernos, suportam auto-update sem signing custom, mas requerem Microsoft Store ou packaging tools menos amigáveis. Rejeitado por escopo.
- **Sigstore / free cert:** rejeitado por SmartScreen não confiar.

**Consequências:**

- Bundle natives via `asarUnpack` (faster-whisper, ffmpeg-static, uIOhook native bindings).
- Path helpers `getBinaryPath(name)` resolvem `app.asar.unpacked` em prod (`process.resourcesPath/app.asar.unpacked/...`).
- Rodada futura adiciona signing + auto-update (electron-updater) quando justificar custo.

---

## ADR-16 — Vocab corrections como pipeline pós-transcrição (não prompt engineering no STT)

**Status:** Accepted

**Contexto:** Whisper (cloud Groq ou local) tem limitada controlabilidade — não dá pra "ensinar" novas palavras via prompt como em LLMs texto. Owner pediu correções customizáveis tipo `kunha → Cunha`, `js → JavaScript`.

**Decisão:** Aplicar correções como **pipeline pós-transcrição** em JS, antes do paste:

1. STT retorna texto cru.
2. `applyVocabCorrections(text, exeName)` lê vocab_entries (global + per-app), substitui via regex word-boundary respeitando `case_sensitive`.
3. `smartPunctuation(text)` (opcional, settings.smart_punctuation default true).
4. `textInjector.paste(textFinal, target)`.

**Alternativas consideradas:**

- **Whisper `initial_prompt`:** Whisper aceita um prompt curto (~224 tokens) que SUGERE vocabulário, mas a correção é estatística e inconsistente — não garante substituição. Útil como sinal adicional futuro, não como mecanismo.
- **LLM post-correction (Groq Llama 3.1):** custo + latência (~500ms a mais) inaceitáveis pra dictation em tempo real.
- **Cliente edita manualmente no histórico:** retroativo, não corrige no paste momento.

**Consequências:**

- Correções aplicam **deterministicamente** (regex), zero latência adicional (~1ms pra dezenas de entries).
- Schema `vocab_entry` (data-model §vocab_entry) suporta `scope='global'` ou exeName específico — usuário pode ter regras diferentes pra Slack vs VSCode.
- Metadata `vocab_corrections_applied` (JSON array) registrada em `transcription` pra auditoria + UI mostrar "3 correções aplicadas" no histórico.
- Edge case: substituição word-boundary não vira "macarrão" em "macarrônica" (regex `\bterm\b`). Test scenario coberto em e4-vocab-correction-pipeline.

---

## Sumário de decisões críticas

| # | Tema | Decisão | Driver principal |
|---|------|---------|------------------|
| ADR-01 | Stack | Electron + TS + React + electron-vite | Reuso playspeak + ecossistema audio/hotkey |
| ADR-02 | Processos | Main grosso, renderer fino | Security (keys nunca em renderer) |
| ADR-03 | DB | better-sqlite3 sync | Performance writes pequenos + simplicidade |
| ADR-04 | STT priority | Groq cloud primary, local opt-in | Diferencial vs Wispr (velocidade) |
| ADR-05 | Multi-key | Pool 3 slots Groq round-robin | CR-1 owner + reuso padrão playspeak |
| ADR-06 | Cascade | 2 níveis (rotação Groq → local) | Não desperdiçar slots ainda disponíveis |
| ADR-07 | Local STT | faster-whisper Python child | Latência 2-4x melhor que whisper.cpp |
| ADR-08 | Text injection | Clipboard paste pattern default | Velocidade + preserva chars especiais |
| ADR-09 | Keypress lib | nut.js | Único maintained no Node moderno |
| ADR-10 | Hotkey hold/release | uIOhook (não Electron globalShortcut) | Electron API não detecta release |
| ADR-11 | Active window | PowerShell GetForegroundWindow | Disponível em todo Win10+ sem dep nativa |
| ADR-12 | Key encryption | Plaintext v0.1, encryption diferido | Custo/risco vs ganho marginal v0.1 |
| ADR-13 | Search | SQLite FTS5 + bm25 | Built-in, escala pro volume previsto |
| ADR-14 | Site | Astro + Cloudflare Pages | Stack default owner + zero JS framework |
| ADR-15 | Build | NSIS .exe + portable .zip, sem signing | Custo cert vs SmartScreen warning aceitável |
| ADR-16 | Vocab correction | Pipeline pós-STT (regex) | Determinístico + zero latência |

---

## Trade-offs / riscos abertos pra rodadas futuras

1. **Code signing** (ADR-15): rodada futura compra cert OV (~$100/ano) → ativa auto-update via `electron-updater`.
2. **Encryption de keys** (ADR-12): migration 0002 usa `safeStorage` DPAPI; export ganha campo opcional com encrypted blob protegido por DPAPI.
3. **Multi-OS** (intake): macOS via codesign + notarization; Linux via AppImage. Reescrita parcial de uIOhook (já cross-platform via `uiohook-napi`) + PowerShell→AppleScript/dbus pra active window. Estimativa: +60% do esforço do flowtype Windows.
4. **Cache de transcrições idênticas** (telemetria evento `cache.hit` reservado): edge case (dictation raramente repete áudio), mas pode dar boost em comandos comuns ("nova reunião", "agendado para amanhã").
5. **Modelo STT trocável em runtime** (ADR-07): Settings/STT permite escolher tiny/base/small/medium pra trade-off velocidade/qualidade.
6. **Provider STT adicional** (ADR-06 cascade 3-nível): Deepgram ou ElevenLabs Scribe como terceiro nível antes do local.
