# flowtype — Internal Contracts (IPC + Providers + Pipelines)

> Não há API HTTP pública. App desktop Electron, Windows-first. Contratos internos:
> (1) IPC main↔renderer (incluindo overlay renderer separado), (2) interfaces de providers
> (STT, KeyPool, TextInjector), (3) pipelines orquestrados, (4) schemas Zod runtime.
> Cobre features e1-* (hotkey/overlay/tray), e2-* (STT cascade multi-key), e3-* (text injection),
> e4-* (UI views), e5-* (onboarding).

---

## 1. IPC main ↔ renderer

Padrão Electron: `ipcMain.handle` + `ipcRenderer.invoke` (request/response), `webContents.send` + `ipcRenderer.on` (events main→renderer). Tudo passa por `preload.ts` com `contextIsolation: true`. Renderer recebe API tipada em `window.flowtype.*`.

Existem **3 renderers distintos**:

| Renderer | Window | Quando criado |
|----------|--------|---------------|
| `main` | hidden | always (background, recebe lifecycle events) |
| `overlay` | always-on-top 180x60 | on boot, sempre presente |
| `settings` | 480x720 | on-demand (tray click / hotkey) |
| `history` | 640x720 | on-demand (tray click) |
| `onboarding` | 720x560 modal | first-run only |

Cada renderer assina apenas os canais relevantes (filtro no preload).

### Tabela de canais

#### Hotkey + capture

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `hotkey:armed` | event | main→overlay+main renderer | `{ hwndSnapshot: WindowInfo }` | — |
| `hotkey:released` | event | main→main renderer | `{ holdDurationMs: number, hwndSnapshot: WindowInfo }` | — |
| `hotkey:test-combo` | event | main→onboarding+settings | `{ combo: string, ok: boolean }` | — |
| `hotkey:rebind` | invoke | settings/onboarding→main | `{ accelerator: string }` | `{ ok: boolean, error?: string }` |
| `mic:start-capture` | invoke | main renderer→main | `{ deviceId?: string }` | `{ captureId: string }` |
| `mic:stop-capture` | invoke | main renderer→main | `{ captureId: string }` | `{ audioBuffer: ArrayBuffer, durationMs: number }` |
| `mic:list-devices` | invoke | renderer→main | `{}` | `{ devices: MediaDeviceInfo[] }` |
| `mic:volume-level` | event | main→overlay+onboarding | `{ rms: number }` (30Hz) | — |

#### STT

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `stt:transcribe-request` | invoke | main renderer→main | `{ audioBuffer: ArrayBuffer, lang?: string }` | `TranscribeResult` |
| `stt:transcribe-response` | event | main→overlay | `TranscribeResult` | — (overlay mostra badge) |
| `stt:force-local-toggle` | invoke | settings→main | `{ enabled: boolean }` | `{ ok: true }` |

#### Groq pool + validation

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `groq:test-key` | invoke | settings/onboarding→main | `{ apiKey: string }` | `ValidateKeyResult` |
| `groq:slot-save` | invoke | settings/onboarding→main | `{ slotIndex: 0\|1\|2, apiKey: string, label?: string, dailyCap?: number }` | `{ ok: boolean, validation: ValidateKeyResult }` |
| `groq:slot-remove` | invoke | settings/onboarding→main | `{ slotIndex: 0\|1\|2 }` | `{ ok: true }` |
| `groq:slot-validate` | invoke | settings/onboarding→main | `{ slotIndex: 0\|1\|2 }` | `ValidateKeyResult` |
| `groq:pool-snapshot` | invoke | settings/history/onboarding→main | `{}` | `PoolSnapshot` |
| `groq:pool-changed` | event | main→all renderers | `PoolSnapshot` | — |

#### Overlay state

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `overlay:set-state` | event | main→overlay | `{ state: 'idle'\|'armed'\|'capturing'\|'processing', meta?: { volumeRms?: number } }` | — |
| `overlay:show-badge` | event | main→overlay | `{ kind: 'groq'\|'local', slotIndex?: number, slotLabel?: string, latencyMs: number, ttlMs: number }` | — |
| `overlay:hot-corner-enter` | event | main→overlay | `{}` | — (overlay opacity=1) |
| `overlay:hot-corner-leave` | event | main→overlay | `{}` | — (volta ao opacity do estado) |

#### Text injection

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `text-injection:paste` | invoke | main→(internal main module) | `{ text: string, targetHwnd: number, exeName: string }` | `PasteResult` |
| `text-injection:result` | event | main→overlay+main renderer | `PasteResult` | — |

#### Active window

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `app:active-window` | invoke | main renderer/settings→main | `{}` | `WindowInfo \| null` |
| `app:active-window-detect-once` | invoke | settings (whitelist UI)→main | `{}` | `WindowInfo` (latest snapshot) |

#### Settings

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `settings:get` | invoke | any renderer→main | `{ key?: string }` (omit = all) | `AppSettings \| Partial<AppSettings>` |
| `settings:set` | invoke | any renderer→main | `{ key: string, value: unknown }` | `{ ok: true }` |
| `settings:reset` | invoke | settings→main | `{ key?: string }` | `{ ok: true }` |
| `settings:changed` | event | main→all renderers | `{ key: string, value: unknown }` | — |
| `settings:export` | invoke | settings→main | `{}` | `{ json: string }` |
| `settings:import` | invoke | settings→main | `{ json: string }` | `{ ok: boolean, errors?: string[] }` |

#### History

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `history:list` | invoke | history→main | `HistoryListRequest` | `{ rows: TranscriptionRow[], total: number }` |
| `history:search` | invoke | history→main | `{ query: string, filters?: HistoryFilters }` | `{ rows: TranscriptionRow[], total: number }` |
| `history:get-audio` | invoke | history→main | `{ id: string }` | `{ filePath: string, exists: boolean }` |
| `history:update` | invoke | history→main | `{ id: string, text: string }` | `{ ok: true }` |
| `history:delete` | invoke | history→main | `{ id: string }` | `{ ok: true }` |
| `history:export` | invoke | history→main | `{ format: 'md'\|'json', filters?: HistoryFilters }` | `{ filePath: string }` (showSaveDialog) |

#### Vocab

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `vocab:list` | invoke | settings→main | `{ scope?: string }` | `{ entries: VocabEntry[] }` |
| `vocab:add` | invoke | settings→main | `Omit<VocabEntry, 'id'\|'times_applied'\|'created_at'\|'updated_at'>` | `{ id: string }` |
| `vocab:update` | invoke | settings→main | `Partial<VocabEntry> & { id: string }` | `{ ok: true }` |
| `vocab:remove` | invoke | settings→main | `{ id: string }` | `{ ok: true }` |

#### App lifecycle

| Canal | Tipo | Direção | Payload | Response |
|-------|------|---------|---------|----------|
| `app:open-settings` | invoke | overlay/tray→main | `{ section?: string }` | `{ ok: true }` |
| `app:open-history` | invoke | overlay/tray→main | `{}` | `{ ok: true }` |
| `app:toggle-mute` | invoke | tray→main | `{}` | `{ muted: boolean }` |
| `app:quit` | invoke | tray→main | `{}` | — |
| `app:auto-start-set` | invoke | settings→main | `{ enabled: boolean }` | `{ openAtLogin: boolean }` |
| `app:onboarding-status` | invoke | main renderer→main | `{}` | `{ needsOnboarding: boolean }` |
| `app:onboarding-complete` | invoke | onboarding→main | `{}` | `{ ok: true }` |

**Total: ~40 canais.** Tudo tipado em `packages/shared/ipc-types.ts` (export de cada tipo de payload + response). Preload usa `contextBridge.exposeInMainWorld('flowtype', {...})` com proxy fortemente tipado.

---

## 2. Interfaces de providers

### 2.1 `SttProvider`

Interface comum implementada por `GroqProvider` e `FasterWhisperLocalProvider`. Cobre e2-groq-provider, e2-faster-whisper-local.

```typescript
interface SttProvider {
  readonly name: 'groq' | 'local';
  transcribe(audio: ArrayBuffer, opts?: TranscribeOptions): Promise<TranscribeResult>;
  isAvailable(): Promise<boolean>;     // checa rede pro groq, child process pro local
}

interface TranscribeOptions {
  language?: string;                   // 'pt-BR' | 'en-US' | undefined (auto-detect)
  mimeType?: string;                   // 'audio/webm;codecs=opus' (default do MediaRecorder)
}

interface TranscribeResult {
  text: string;                        // texto cru do provider (sem vocab/punct)
  latencyMs: number;                   // medido pelo provider (request→response)
  provider: 'groq' | 'local';
  slotIndex?: number;                  // só pra groq (0|1|2)
  slotLabel?: string;                  // label opcional do slot
  language?: string;                   // detected by provider, se aplicável
  durationMs?: number;                 // duração do áudio (se provider reporta)
}
```

### 2.2 `GroqKeyPool`

Primitiva multi-slot com estado por key. Cobre e2-groq-key-pool, e2-groq-pool-rotation, CR-1.

```typescript
type GroqSlotStatus = 'online' | 'invalid' | 'exhausted';

interface GroqSlot {
  slotIndex: 0 | 1 | 2;
  apiKey: string;                      // texto plano em memória (v0.1)
  label?: string;
  dailyCap: number;                    // default 14400
  status: GroqSlotStatus;
  usedToday: number;
  lastReset: string;                   // ISO 8601 UTC
}

interface SlotSnapshot {
  slotIndex: 0 | 1 | 2;
  hasKey: boolean;
  label?: string;
  status: GroqSlotStatus;
  usedToday: number;
  dailyCap: number;
  pctUsed: number;                     // 0-100
  lastValidatedAt?: string;
}

interface PoolSnapshot {
  totalSlots: 3;                       // sempre 3 (fixo)
  online: number;
  invalid: number;
  exhausted: number;
  totalUsedToday: number;
  slots: SlotSnapshot[];               // sempre 3 elementos
}

class GroqKeyPool {
  constructor(opts: { repo: TokenUsageRepo, slotMetaRepo: GroqSlotMetaRepo });

  /** Retorna próximo slot online (round-robin). Throws PoolEmptyError se nenhum. */
  next(): { apiKey: string; slotIndex: 0 | 1 | 2; label?: string };

  /** Marca slot como exhausted (429 ou daily_cap). Volta online no próximo resetDaily(). */
  markExhausted(slotIndex: 0 | 1 | 2): void;

  /** Marca slot como invalid (401). Não volta online sozinho — exige re-validate manual. */
  markInvalid(slotIndex: 0 | 1 | 2): void;

  /** Incrementa usedToday + persiste em token_usage. Auto-exhausted ao atingir dailyCap. */
  incrementUsage(slotIndex: 0 | 1 | 2, count?: number): void;

  /** true se nenhum slot está online. */
  allUnavailable(): boolean;

  /** Quantos slots estão online agora. */
  onlineCount(): number;

  /** Snapshot pra UI/telemetria (não muta estado). */
  snapshot(): PoolSnapshot;

  /** Reset diário: zera usedToday + limpa exhausted (mantém invalid). */
  resetDaily(): void;

  /** Adiciona/substitui slot (chamado por settings/onboarding após validateGroqKey). */
  setSlot(slotIndex: 0 | 1 | 2, opts: { apiKey: string; label?: string; dailyCap?: number }): void;

  /** Remove slot (clear). */
  clearSlot(slotIndex: 0 | 1 | 2): void;
}

class PoolEmptyError extends Error { code = 'POOL_EMPTY'; }
```

**Round-robin:** mantém ponteiro `nextSlotIndex` que avança a cada `next()` (módulo 3). Skipa slots `invalid` ou `exhausted`. Tie-breaker quando empate em `usedToday` (rare): menor `slotIndex`.

**Persistência:** todo `markExhausted` / `markInvalid` / `incrementUsage` escreve em `token_usage` via `TokenUsageRepo` pra resiliência (restart do app preserva estado do dia).

### 2.3 `ValidateKeyResult` (helper `validateGroqKey`)

Cobre e2-groq-key-validation.

```typescript
interface ValidateKeyResult {
  valid: boolean;
  error?: string;                      // user-facing PT-BR
  latencyMs: number;
  shouldMarkExhausted?: boolean;       // true se 200 OK MAS body sinaliza 429 (raro)
}

async function validateGroqKey(apiKey: string): Promise<ValidateKeyResult> {
  // GET https://api.groq.com/openai/v1/models, timeout 3s
  // 200 + body contém whisper-large-v3-turbo → { valid: true, latencyMs }
  // 401 → { valid: false, error: 'Key inválida ou expirada' }
  // 429 → { valid: true, shouldMarkExhausted: true } (key existe mas sem cota)
  // timeout → { valid: false, error: 'Timeout — verifique conexão' }
  // network → { valid: false, error: 'Sem conexão com api.groq.com' }
}
```

### 2.4 `SttGateway`

Orquestra cascade em 2 níveis. Cobre e2-stt-cascade-fallback.

```typescript
interface CascadeAttempt {
  slotIndex?: number;
  provider: 'groq' | 'local';
  error?: string;
  latencyMs: number;
}

interface CascadeResult extends TranscribeResult {
  fellBack: boolean;                   // true se acabou em local após Groq falhar
  attempts: CascadeAttempt[];          // ordem cronológica
  keyRotationCount: number;            // trocas de slot DENTRO do nível 1
}

class SttGateway {
  constructor(opts: {
    groqProvider: GroqProvider;        // injeta pool internamente
    localProvider: FasterWhisperLocalProvider;
    pool: GroqKeyPool;
    settings: SettingsRepo;
  });

  async transcribe(audio: ArrayBuffer, opts?: TranscribeOptions): Promise<CascadeResult>;
  // Lógica:
  //  if settings.stt_force_local: vai direto local
  //  else:
  //    while pool.onlineCount() > 0:
  //      try groqProvider.transcribe (usa pool.next() internamente)
  //      catch 429: pool.markExhausted, key_rotation++, retry IMEDIATO próximo slot
  //      catch 401: pool.markInvalid, key_rotation++, retry IMEDIATO próximo slot
  //      catch timeout (1x): retry mesmo slot 1x
  //      catch timeout (2x): NÃO marca exhausted, força fall_back_local
  //    if pool.allUnavailable() OR timeout repetido: localProvider.transcribe, fellBack=true
}
```

### 2.5 `TextInjector`

Interface pra mecanismo de injeção. Implementação default `ClipboardPasteInjector`. Cobre e3-clipboard-snapshot-restore, e3-paste-ctrl-v, e3-refocus-target-window, e3-typing-fallback.

```typescript
interface WindowInfo {
  hwnd: number;                        // handle nativo Windows
  exeName: string;                     // lowercase, ex.: 'notepad.exe'
  windowTitle: string;
  processId: number;
}

interface PasteResult {
  method: 'clipboard' | 'typing';      // qual caminho rodou
  success: boolean;
  targetWindow: WindowInfo;
  refocused: boolean;                  // true se precisou refoco
  errorReason?: string;                // 'window_lost' | 'paste_blocked' | 'nut_js_error'
  totalMs: number;                     // wall-clock paste pipeline
}

interface TextInjector {
  paste(text: string, target: WindowInfo): Promise<PasteResult>;
}

class ClipboardPasteInjector implements TextInjector {
  constructor(opts: {
    blacklist: string[];               // exeNames onde NÃO injeta
    forceTyping: string[];             // exeNames onde digita char-por-char
    restoreDelayMs?: number;           // default 200ms
    typingCharDelayMs?: number;        // default 8ms
  });

  // Pipeline interno (executa em sequência):
  //  1. if target.exeName in blacklist: return { success: false, errorReason: 'app_blacklisted' }
  //  2. snapshot = clipboard.readText() + readHTML() + readImage()
  //  3. refocus target.hwnd via PowerShell SetForegroundWindow (timeout 80ms)
  //     if hwnd inválido: return { success: false, errorReason: 'window_lost' }
  //  4. if target.exeName in forceTyping: nut.keyboard.type(text), char delay 8ms
  //  5. else: clipboard.writeText(text), nut.keyboard.pressKey(Key.LeftControl, Key.V), sleep 80ms, releaseKey
  //  6. setTimeout(restoreDelayMs): restore clipboard.write(snapshot.text/html/image)
  //  7. return { success: true, ... }
}
```

### 2.6 `ActiveWindowDetector`

Cobre e3-active-window-detect.

```typescript
interface ActiveWindowDetector {
  /** Spawn PowerShell GetForegroundWindow; cache snapshot por ~100ms. */
  getActive(): Promise<WindowInfo | null>;

  /** Re-foca janela via SetForegroundWindow. */
  refocus(hwnd: number): Promise<boolean>;
}
```

Implementação: spawn `powershell -NoProfile -Command "Add-Type @' [DllImport...] ... '@; ..."` com cache short-lived pra reduzir overhead (latency p95 < 100ms target).

---

## 3. Pipelines orquestrados

Sequências ordenadas que conectam IPC + providers + DB. Documenta o fluxo end-to-end de cada feature crítica.

### 3.1 Pipeline `hotkey-to-paste` (caminho feliz)

```
[uIOhook] Right Ctrl DOWN >300ms
  → main: snapshot activeWindow → hwndSnapshot
  → main: emit overlay:set-state {state:'armed', hwndSnapshot}
  → main: mic:start-capture (em main renderer via webContents.send)
  → main renderer: MediaRecorder.start() (webm/opus)
  → loop: AnalyserNode.rms → main → overlay:set-state {state:'capturing', meta.volumeRms}

[uIOhook] Right Ctrl UP
  → main: mic:stop-capture → recebe audioBuffer + durationMs
  → main: emit overlay:set-state {state:'processing'}
  → main: SttGateway.transcribe(audioBuffer, {lang: settings.stt_language})
         ├── pool.next() → fetch Groq (rotação se 429/401)
         └── fallback localProvider se pool.allUnavailable()
  → main: applyVocabCorrections(result.text, hwndSnapshot.exeName)
  → main: smartPunctuation(text) se settings.smart_punctuation
  → main: textInjector.paste(textFinal, hwndSnapshot)
         ├── refocus hwnd via PowerShell
         ├── clipboard snapshot
         ├── clipboard.writeText(text)
         ├── nut.js Ctrl+V (ou typing se blacklist)
         └── setTimeout 200ms: restore clipboard
  → main: emit overlay:show-badge {kind, slotIndex, slotLabel, latencyMs, ttlMs:1500}
  → main: TranscriptionRepo.insert({...all metadata, vocab_corrections_applied: applied,
                                     paste_method, paste_succeeded, target_window_lost_focus})
  → main: salva audioBuffer em recordings/YYYY-MM-DD/<ulid>.opus
  → main: emit overlay:set-state {state:'idle'} (após 1.5s, depois do badge)
```

**Latência alvo (p50):** `released → paste_done < 1500ms` com Groq (e8-perf-gate-p50).

### 3.2 Pipeline `groq-rotation` (multi-key)

```
For attempt in [1..pool.onlineCount()]:
  slot = pool.next()                           // round-robin
  try:
    response = fetch groq /audio/transcriptions com slot.apiKey, timeout 5s
    pool.incrementUsage(slot.slotIndex)
    return { text, latencyMs, provider:'groq', slotIndex:slot.slotIndex, slotLabel:slot.label }
  catch HTTP 429:
    pool.markExhausted(slot.slotIndex)
    keyRotationCount++
    log structured: { event:'groq.rotation', from_slot:slot.slotIndex, to_slot:next_slot_idx, reason:'429' }
    continue
  catch HTTP 401:
    pool.markInvalid(slot.slotIndex)
    keyRotationCount++
    log structured: { event:'groq.rotation', ..., reason:'401' }
    continue
  catch timeout (1x):
    retry mesmo slot UMA vez
    if timeout again: NÃO marca exhausted, lança GroqTimeoutError → cascade pra local
  catch network:
    lança GroqOfflineError → cascade pra local
// se loop esgotou sem retornar: pool.allUnavailable() === true → cascade pra local
```

### 3.3 Pipeline `text-injection-paste`

```
1. if target.exeName in blacklist:
     emit toast 'app bloqueado'
     return { success: false, errorReason: 'app_blacklisted' }

2. snapshot = {
     text: clipboard.readText(),
     html: clipboard.readHTML(),
     image: clipboard.readImage(),
   }

3. focused = await activeWindowDetector.refocus(target.hwnd)
   if !focused: return { success: false, errorReason: 'window_lost', refocused: false }

4. if target.exeName in forceTyping:
     await nut.keyboard.type(text)  // char delay 8ms
     method = 'typing'
   else:
     clipboard.writeText(text)
     await nut.keyboard.pressKey(Key.LeftControl, Key.V)
     await sleep(80)
     await nut.keyboard.releaseKey(Key.LeftControl, Key.V)
     method = 'clipboard'

5. setTimeout(restoreDelayMs):
     if snapshot.text: clipboard.writeText(snapshot.text)
     else if snapshot.html: clipboard.writeHTML(snapshot.html)
     else if snapshot.image: clipboard.writeImage(snapshot.image)
     else: clipboard.clear()

6. return { method, success: true, targetWindow, refocused, totalMs }
```

### 3.4 Pipeline `onboarding-wizard`

```
Boot: if !settings.first_run_completed: open onboarding window

Step 1 (welcome): static content, "Próximo" → step 2
Step 2 (mic): navigator.mediaDevices.getUserMedia + enumerateDevices
              + live meter via AnalyserNode → "Próximo"
Step 3 (hotkey): default Right Ctrl card; "Mudar" captura próxima keydown via uIOhook;
                 área de teste reage live → "Próximo" só após detect 1x successful
Step 4 (test): se nenhum slot: form inline (paste + label + validateGroqKey) → slot 0 saved
               grava 5s → SttGateway.transcribe → mostra texto + slot used + latência
               card collapsible "Triplicar quota" → expand <GroqSlotManager compact />
                 (renderiza 2 slots adicionais com mesmas ações de add/test/remove)
               "Concluir" → settings.first_run_completed=true → fecha onboarding
```

### 3.5 Pipeline `vocab-correction`

```
After STT, before injection:
  global = vocabRepo.listByScope('global')
  perApp = vocabRepo.listByScope(exeName)
  entries = [...global, ...perApp]
  appliedList = []
  let result = text
  for entry in entries:
    pattern = new RegExp(`\\b${escapeRegex(entry.term_wrong)}\\b`, entry.case_sensitive ? 'g' : 'gi')
    if pattern.test(result):
      result = result.replace(pattern, entry.term_correct)
      appliedList.push({ wrong: entry.term_wrong, correct: entry.term_correct, scope: entry.scope })
      vocabRepo.incrementTimesApplied(entry.id)
  return { text: result, applied: appliedList }
```

---

## 4. Schemas TS + validação Zod

Schemas runtime exportados de `packages/shared/schemas.ts`. Usados pra validar payloads IPC e cargas persistidas. Cobre principalmente settings export/import (e2-stt-settings-provider e4-history-export).

### 4.1 `AppSettings`

```typescript
import { z } from 'zod';

export const AppSettingsSchema = z.object({
  // Hotkey
  hotkey: z.string().default('Right Ctrl'),       // 'Right Ctrl' | 'F12' | combo Electron-style
  hotkey_hold_min_ms: z.number().int().min(0).max(2000).default(300),

  // Microfone
  mic_device_id: z.string().optional(),           // 'default' | deviceId

  // STT
  stt_force_local: z.boolean().default(false),
  stt_language: z.enum(['pt-BR', 'en-US', 'es', 'fr', 'de', 'it']).nullable().default(null),

  // Lifecycle
  auto_start: z.boolean().default(false),
  first_run_completed: z.boolean().default(false),
  muted: z.boolean().default(false),

  // Overlay
  overlay_position: z.enum(['br', 'bl', 'tr', 'tl', 'custom']).default('br'),
  overlay_custom_xy: z.tuple([z.number(), z.number()]).optional(),
  overlay_idle_opacity: z.number().min(0).max(1).default(0.3),

  // Text injection
  smart_punctuation: z.boolean().default(true),
  app_blacklist: z.array(z.string().toLowerCase()).default([]),
  app_force_typing: z.array(z.string().toLowerCase()).default([]),

  // Retention
  transcription_retention_days: z.number().int().min(7).max(365).default(90),
  audio_retention_days: z.number().int().min(1).max(180).default(30),
  token_usage_retention_days: z.number().int().min(7).max(365).default(90),

  // Telemetry (opt-in, default OFF — limite ético do intake)
  telemetry_enabled: z.boolean().default(false),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
```

### 4.2 `VocabEntry`

```typescript
export const VocabEntrySchema = z.object({
  id: z.string().length(26),                      // ULID
  term_wrong: z.string().min(1).max(200),
  term_correct: z.string().min(1).max(500),
  case_sensitive: z.boolean().default(false),
  scope: z.string().default('global'),            // 'global' | exeName lowercase
  times_applied: z.number().int().nonnegative().default(0),
  created_at: z.string(),                         // ISO 8601 UTC
  updated_at: z.string(),
});

export type VocabEntry = z.infer<typeof VocabEntrySchema>;
```

### 4.3 `TranscribePayload` (IPC `stt:transcribe-request`)

```typescript
export const TranscribePayloadSchema = z.object({
  audioBuffer: z.instanceof(ArrayBuffer),
  lang: z.enum(['pt-BR', 'en-US', 'es', 'fr', 'de', 'it']).optional(),
  mimeType: z.string().default('audio/webm;codecs=opus'),
});
```

### 4.4 `SettingsExport` (export/import)

```typescript
export const SettingsExportSchema = z.object({
  version: z.literal('1'),
  exportedAt: z.string(),                         // ISO 8601 UTC
  appSettings: AppSettingsSchema,
  vocabEntries: z.array(VocabEntrySchema),
  groqSlots: z.array(z.object({                   // SEM apiKey (segurança)
    slotIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    label: z.string().optional(),
    dailyCap: z.number().int().positive(),
    hasKey: z.boolean(),                          // sinaliza presença mas não exporta
  })),
});
```

**Nota de segurança:** export NUNCA inclui `apiKey`. Import preserva slot metadata mas exige re-paste das keys. Documentado no FAQ do site.

### 4.5 `HistoryListRequest` / `HistoryFilters`

```typescript
export const HistoryFiltersSchema = z.object({
  dateFrom: z.string().optional(),                // ISO 8601 UTC
  dateTo: z.string().optional(),
  appExe: z.array(z.string()).optional(),         // multi-select
  provider: z.enum(['groq', 'local']).optional(),
});

export const HistoryListRequestSchema = z.object({
  filters: HistoryFiltersSchema.optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(200).default(50),
  sort: z.enum(['ts_desc', 'ts_asc']).default('ts_desc'),
});
```

---

## 5. Telemetria (eventos estruturados)

Logados via `console.info(JSON.stringify({...}))` em prod (Electron file log) e pra ingestão futura. Todos eventos têm shape `{ event: string, ts: ISO, ...payload }`. Cobre observabilidade base sem opt-in (apenas log local; envio externo gated por `settings.telemetry_enabled`).

### 5.1 `groq.rotation`

```typescript
type GroqRotationEvent = {
  event: 'groq.rotation';
  ts: string;
  from_slot: 0 | 1 | 2;
  to_slot: 0 | 1 | 2 | null;          // null se foi pro local
  reason: '429' | '401' | 'timeout' | 'pool_empty';
  attempt_in_turn: number;
};
```

### 5.2 `paste.fallback`

```typescript
type PasteFallbackEvent = {
  event: 'paste.fallback';
  ts: string;
  from_method: 'clipboard';
  to_method: 'typing';
  exe_name: string;
  reason: 'blacklisted' | 'detected_failure' | 'force_typing_list';
};
```

### 5.3 `transcription.completed`

```typescript
type TranscriptionCompletedEvent = {
  event: 'transcription.completed';
  ts: string;
  transcription_id: string;             // ULID
  provider_used: 'groq' | 'local';
  slot_index?: number;
  latency_ms: number;
  duration_ms: number;
  vocab_corrections_count: number;
  paste_method: 'clipboard' | 'typing';
  paste_succeeded: boolean;
  fell_back: boolean;
  key_rotation_count: number;
};
```

### 5.4 `pool.snapshot.tick`

Emitido cada vez que pool muda (debounced 500ms):

```typescript
type PoolSnapshotTickEvent = {
  event: 'pool.snapshot.tick';
  ts: string;
  snapshot: PoolSnapshot;
};
```

### 5.5 `cache.hit` (rodada futura)

Reservado pra quando adicionarmos cache de transcrições idênticas (raro em dictation, mas previsto):

```typescript
type CacheHitEvent = {
  event: 'cache.hit';
  ts: string;
  audio_hash: string;
  source: 'stt';
};
```

---

## 6. Erros tipados (cross-module)

Exportados de `packages/shared/errors.ts`:

```typescript
export class GroqAuthError extends Error { code = 'GROQ_AUTH' as const; }
export class GroqRateLimitError extends Error { code = 'GROQ_RATE_LIMIT' as const; }
export class GroqTimeoutError extends Error { code = 'GROQ_TIMEOUT' as const; }
export class GroqOfflineError extends Error { code = 'GROQ_OFFLINE' as const; }
export class PoolEmptyError extends Error { code = 'POOL_EMPTY' as const; }
export class LocalSttSpawnError extends Error { code = 'LOCAL_STT_SPAWN' as const; }
export class WindowLostError extends Error { code = 'WINDOW_LOST' as const; }
export class PasteBlockedError extends Error { code = 'PASTE_BLOCKED' as const; }
export class NotFoundError extends Error { code = 'NOT_FOUND' as const; }
export class ValidationError extends Error {
  code = 'VALIDATION' as const;
  constructor(msg: string, public zodIssues?: unknown) { super(msg); }
}
```

Erros propagam main→renderer via IPC com shape `{ ok: false, error: { code, message } }` (jamais expõe stack trace na UI em prod, regra hard do owner).
