# flowtype — Data Model (SQLite local)

> Tudo em `%APPDATA%/flowtype/db.sqlite`. Áudios em `%APPDATA%/flowtype/recordings/YYYY-MM-DD/`.
> Acessado via `better-sqlite3` (sync) no main process. IDs em ULID. Timestamps em ISO 8601 UTC.
> Cobre features e6-* + base operacional pra e2-* (pool/cascade), e3-* (text injection metadata),
> e4-* (histórico FTS5, vocab).

---

## Localização física

```
%APPDATA%/flowtype/
├── db.sqlite                          # banco principal (better-sqlite3)
├── db.sqlite-wal                      # WAL (journal_mode=WAL)
├── db.sqlite-shm
├── secrets.env                        # GROQ_API_KEY_{1,2,3} em prod (gitignored)
└── recordings/
    └── YYYY-MM-DD/
        └── <ulid>.opus                # mesmo ULID da row transcription
```

Em dev: `.studio/local/flowtype-secrets.env` (gitignored) substitui `secrets.env`.

**Pragmas obrigatórios** no boot da DB (executados antes de qualquer migration):

```sql
PRAGMA journal_mode = WAL;             -- writes concorrentes, reads não bloqueiam
PRAGMA synchronous = NORMAL;           -- balance durabilidade/perf pra app desktop
PRAGMA foreign_keys = ON;              -- enforça FK declaradas
PRAGMA temp_store = MEMORY;            -- queries temporárias em RAM
PRAGMA busy_timeout = 5000;            -- 5s waiting em locks
```

---

## Convenções

- **IDs:** ULID via lib `ulid` (string TEXT). Ordenável temporalmente, 26 chars Crockford base32.
- **Timestamps:** ISO 8601 UTC (`new Date().toISOString()`), TEXT em SQLite. Coluna `day` em `token_usage` usa `YYYY-MM-DD` UTC (alinha com reset diário 00:00 UTC).
- **JSON:** colunas `value` / `vocab_corrections_applied` armazenam JSON serializado; validação Zod no acesso (encode/decode com schemas exportados em `packages/shared/db-schemas.ts`).
- **Booleans:** INTEGER 0/1 (SQLite não tem BOOLEAN nativo).
- **Encryption v0.1:** Groq API keys ficam em **texto plano** em `secrets.env` + memória do main process. NÃO entram em SQLite. Encryption via `keytar`/`safeStorage` fica pra rodada futura (ver ADR-12 em `architecture-decisions.md`).
- **Convenção de nomes:** `snake_case` em colunas e tabelas (convenção SQLite). Singular para nomes de tabela (`transcription`, não `transcriptions`).

---

## Diagrama de relacionamento

```
┌──────────────────┐                    ┌──────────────────┐
│  transcription   │ 1:1 (trigger sync) │ transcription_fts│
│ (id ULID PK)     │ ←──────────────────│  (FTS5 virtual)  │
│  text, audio,    │                    │  text mirror     │
│  app_*, provider │                    └──────────────────┘
│  _used, slot_*,  │
│  latency_ms,     │
│  vocab_correc... │
└──────────────────┘
        │
        │ (ULID = audio file name)
        ↓
%APPDATA%/flowtype/recordings/YYYY-MM-DD/<ulid>.opus

┌──────────────────┐         ┌──────────────────┐
│   vocab_entry    │         │     settings     │
│ (id ULID PK)     │         │ (key TEXT PK)    │
│  term_wrong,     │         │  value JSON      │
│  term_correct,   │         │  updated_at      │
│  case_sensitive, │         └──────────────────┘
│  scope, times_*  │
└──────────────────┘

┌──────────────────┐         ┌──────────────────┐
│  groq_slot_meta  │ 1:N     │   token_usage    │
│ (slot_index PK)  │ ──────→ │ (UNIQUE provider,│
│  api_key_encr,   │         │   slot_index,    │
│  label, daily_*, │         │   day)           │
│  validation_*    │         │  requests_count, │
└──────────────────┘         │  marked_exh_at   │
                             └──────────────────┘

┌──────────────────┐
│   _migrations    │ (tracking)
│  id, name,       │
│  applied_at      │
└──────────────────┘
```

---

## Tabelas

### `_migrations`

Tracker de migrations aplicadas. Criada antes de tudo pelo runner.

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,            -- '0001_initial', '0002_add_field'
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Runner: lê `db/migrations/*.sql` em ordem alfabética, pula nomes já presentes em `_migrations`, executa o restante dentro de `BEGIN; ... COMMIT;`. Falha → rollback + abort do boot com mensagem clara.

---

### `transcription` (core)

Uma row por ciclo `hotkey-released → STT → paste`. Cobre features e2-stt-telemetry-timing, e3-*, e4-history-*, e6-schema-transcription.

```sql
CREATE TABLE transcription (
  id                          TEXT PRIMARY KEY,         -- ULID
  ts                          TEXT NOT NULL,            -- ISO 8601 UTC (criado no insert)
  text                        TEXT NOT NULL,            -- texto final (já com vocab + punct)
  audio_path                  TEXT,                     -- relativo: 'YYYY-MM-DD/<ulid>.opus'
  app_exe                     TEXT,                     -- 'notepad.exe', 'claude.exe' (lowercase)
  app_window_title            TEXT,                     -- título no momento do hotkey-released
  app_field_type              TEXT,                     -- 'text', 'password', 'unknown' (opt v0.1)
  provider_used               TEXT NOT NULL,            -- 'groq' | 'local'
  slot_index                  INTEGER,                  -- 0|1|2 se provider='groq'; NULL se local
  slot_label                  TEXT,                     -- label opcional do slot (e.g. "primary")
  latency_ms                  INTEGER NOT NULL,         -- t_paste_done - t_released
  duration_ms                 INTEGER NOT NULL,         -- duração do áudio capturado
  language                    TEXT,                     -- 'pt-BR' | 'en-US' | NULL (auto)
  vocab_corrections_applied   TEXT NOT NULL DEFAULT '[]', -- JSON array de { wrong, correct, scope }
  paste_method                TEXT NOT NULL,            -- 'clipboard' | 'typing'
  paste_succeeded             INTEGER NOT NULL DEFAULT 1,  -- 0/1
  target_window_lost_focus    INTEGER NOT NULL DEFAULT 0,  -- 0/1 (true se refocus precisou rodar)
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (provider_used IN ('groq', 'local')),
  CHECK (paste_method IN ('clipboard', 'typing'))
);

CREATE INDEX idx_transcription_ts        ON transcription(ts DESC);
CREATE INDEX idx_transcription_app_exe   ON transcription(app_exe);
CREATE INDEX idx_transcription_provider  ON transcription(provider_used, ts DESC);
```

**Notas:**

- `ts` e `created_at` são equivalentes em v0.1; mantemos ambos pra futuro (ex.: edit retroativo poderia preservar `ts` original e mexer em `updated_at`).
- `slot_index` 0-indexed (Slot #1 UI = slot_index=0).
- `vocab_corrections_applied`: array vazio `[]` quando nenhuma correção aplicada. Estrutura: `[{ wrong: "kunha", correct: "Cunha", scope: "global" }, ...]`.

---

### `transcription_fts` (FTS5 virtual)

Espelho de `text` pra busca full-text com bm25. Cobre e4-history-search-filters, e6-fts5-search.

```sql
CREATE VIRTUAL TABLE transcription_fts USING fts5(
  text,
  content='transcription',
  content_rowid='rowid',
  tokenize = 'porter unicode61 remove_diacritics 2'
);
```

**Triggers de sync** (AFTER, não BEFORE, pra pegar o `text` final inserido):

```sql
CREATE TRIGGER transcription_ai AFTER INSERT ON transcription BEGIN
  INSERT INTO transcription_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER transcription_ad AFTER DELETE ON transcription BEGIN
  INSERT INTO transcription_fts(transcription_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER transcription_au AFTER UPDATE OF text ON transcription BEGIN
  INSERT INTO transcription_fts(transcription_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO transcription_fts(rowid, text) VALUES (new.rowid, new.text);
END;
```

**Por que AFTER e não BEFORE:** o padrão FTS5 com `content='transcription'` exige delete sentinel + insert no AFTER pra manter o índice consistente; BEFORE poderia ler dados que serão revertidos em rollback de transaction.

**Query típica de busca:**

```sql
SELECT t.*, bm25(transcription_fts) AS rank
FROM transcription_fts
JOIN transcription t ON t.rowid = transcription_fts.rowid
WHERE transcription_fts MATCH ?
  AND (? IS NULL OR t.ts >= ?)
  AND (? IS NULL OR t.app_exe = ?)
ORDER BY rank
LIMIT 50;
```

---

### `vocab_entry`

Correções pós-transcrição aplicadas antes do paste. Cobre e4-vocab-custom-list, e4-vocab-correction-pipeline, e6-schema-vocab.

```sql
CREATE TABLE vocab_entry (
  id              TEXT PRIMARY KEY,                    -- ULID
  term_wrong      TEXT NOT NULL,
  term_correct    TEXT NOT NULL,
  case_sensitive  INTEGER NOT NULL DEFAULT 0,          -- 0/1
  scope           TEXT NOT NULL DEFAULT 'global',      -- 'global' | <exeName lowercase>
  times_applied   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (length(term_wrong) > 0),
  CHECK (length(term_correct) > 0)
);

CREATE INDEX idx_vocab_scope ON vocab_entry(scope);
```

**Pipeline de aplicação** (helper `applyVocabCorrections(text, exeName)`):

1. Lê rows `WHERE scope = 'global' OR scope = ?exeName`.
2. Para cada row: substitui via regex word-boundary (`\bterm_wrong\b`), flag `/i` quando `case_sensitive=0`.
3. Incrementa `times_applied` em batch (UPDATE single statement).
4. Retorna `{ text: corrigido, applied: [{ wrong, correct, scope }, ...] }` pra registro em `transcription.vocab_corrections_applied`.

---

### `settings`

Key-value JSON. Cobre e6-schema-settings + persistência de toggles/listas das outras features.

```sql
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,                           -- JSON serializado
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Helpers em `SettingsRepo`:**

```typescript
getSetting<T>(key: string, fallback: T): T;
setSetting<T>(key: string, value: T): void;
resetSetting(key: string): void;
getAll(): Record<string, unknown>;
```

Cache in-memory invalidado em qualquer `setSetting`. Defaults documentados em `const SETTINGS_DEFAULTS` (ver `internal-contracts.md` §6 — schema `AppSettings`).

---

### `token_usage`

Consumo diário por slot Groq. Persiste estado do `GroqKeyPool` pra resiliência (app reinicia → recupera estado de exhaustion sem perder o dia). Cobre e2-groq-key-pool, e6-schema-token-usage.

```sql
CREATE TABLE token_usage (
  id                    TEXT PRIMARY KEY,              -- ULID
  provider              TEXT NOT NULL,                 -- 'groq' (v0.1: só groq; futuro: outros)
  slot_index            INTEGER NOT NULL,              -- 0|1|2
  slot_label            TEXT,                          -- label opcional (espelha groq_slot_meta)
  day                   TEXT NOT NULL,                 -- 'YYYY-MM-DD' UTC
  requests_count        INTEGER NOT NULL DEFAULT 0,
  last_used_at          TEXT,                          -- ISO 8601 UTC
  marked_exhausted_at   TEXT,                          -- ISO 8601 UTC (NULL se ativo)
  marked_invalid_at     TEXT,                          -- ISO 8601 UTC (persiste cross-day)
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(provider, slot_index, day)
);

CREATE INDEX idx_token_usage_provider_day ON token_usage(provider, day);
CREATE INDEX idx_token_usage_slot_day     ON token_usage(slot_index, day);
```

**Notas:**

- `UNIQUE(provider, slot_index, day)` garante uma row por slot/dia. Repo usa `INSERT ... ON CONFLICT(provider, slot_index, day) DO UPDATE SET ...` (UPSERT) pra evitar race em primeiro request do dia.
- `marked_invalid_at` persiste cross-day (key revogada continua inválida amanhã também, até user re-validar manualmente em Settings).
- `marked_exhausted_at` zera no `resetDaily()` (cron 00:00 UTC + app boot se `lastReset > 24h`).

---

### `groq_slot_meta`

Metadados por slot Groq (1:1 com slots fixos #1/#2/#3). Cobre e2-groq-key-pool, e2-stt-settings-provider. Persistência de keys + label + cap + status de validação.

```sql
CREATE TABLE groq_slot_meta (
  slot_index          INTEGER PRIMARY KEY,             -- 0 | 1 | 2 (constraint via CHECK)
  api_key_encrypted   TEXT,                            -- v0.1: texto plano (ver ADR-12)
  label               TEXT,                            -- 'primary', 'backup', etc
  daily_cap           INTEGER NOT NULL DEFAULT 14400,  -- limite free tier Groq
  added_at            TEXT,                            -- ISO 8601 UTC; NULL se slot vazio
  last_validated_at   TEXT,                            -- última run de validateGroqKey()
  validation_status   TEXT NOT NULL DEFAULT 'untested',  -- 'online' | 'invalid' | 'untested'

  CHECK (slot_index IN (0, 1, 2)),
  CHECK (validation_status IN ('online', 'invalid', 'untested')),
  CHECK (daily_cap > 0)
);
```

**Bootstrap** (no boot do main process):

1. SELECT all from `groq_slot_meta` (sempre 0-3 rows; rows vazias têm `api_key_encrypted = NULL`).
2. Se vazia: lê `secrets.env` (em prod: `%APPDATA%/flowtype/secrets.env`; em dev: `.studio/local/flowtype-secrets.env`) procurando `GROQ_API_KEY`, `GROQ_API_KEY_2`, `GROQ_API_KEY_3` + `GROQ_API_KEY_LABEL_{1,2,3}`.
3. Pra cada key encontrada: INSERT em `groq_slot_meta` com `validation_status='untested'`. Validação async via `validateGroqKey()` no primeiro idle.
4. UI Settings/STT lê SELECT e renderiza os 3 cards.

**Nota:** `api_key_encrypted` é o nome da coluna pra deixar futuro encryption sem migration breaking. Em v0.1, valor é texto plano (gerencia-se via filesystem permissions de `%APPDATA%/flowtype/`).

---

## Migrations

Versionadas, idempotentes, em `db/migrations/` no monorepo da app. Cobre e6-migrations-versioned.

```
db/migrations/
├── 0001_initial.sql       # cria todas tabelas + FTS + triggers + índices acima
└── 0002_*.sql             # futuras (ex.: encryption migration quando ativarmos keytar)
```

**Estrutura de cada migration:**

```sql
-- 0001_initial.sql
-- Cria schema base flowtype v0.1

BEGIN;

-- _migrations já existe (criada pelo runner antes de tudo)

CREATE TABLE transcription ( ... );
CREATE INDEX idx_transcription_ts ON transcription(ts DESC);
-- ...

CREATE VIRTUAL TABLE transcription_fts USING fts5( ... );
CREATE TRIGGER transcription_ai AFTER INSERT ON transcription BEGIN ... END;
-- ...

CREATE TABLE vocab_entry ( ... );
CREATE TABLE settings ( ... );
CREATE TABLE token_usage ( ... );
CREATE TABLE groq_slot_meta ( ... );

-- Seed dos 3 slots Groq vazios (rows fixas; UI só preenche api_key)
INSERT INTO groq_slot_meta (slot_index, daily_cap, validation_status) VALUES
  (0, 14400, 'untested'),
  (1, 14400, 'untested'),
  (2, 14400, 'untested');

COMMIT;
```

**Runner pseudocódigo** (`db/migrate.ts`, executa em `app.whenReady` antes de qualquer query):

```typescript
function runMigrations(db: Database) {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT (datetime(\'now\')))');
  const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
  const files = readdirSync('db/migrations').filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const name = file.replace('.sql', '');
    if (applied.has(name)) continue;
    const sql = readFileSync(`db/migrations/${file}`, 'utf-8');
    try {
      db.exec(sql);                                              // sql já tem BEGIN/COMMIT
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
      console.log(`[migrate] applied ${name}`);
    } catch (err) {
      console.error(`[migrate] FAILED ${name}: ${err.message}`);
      app.exit(1);                                               // abort com mensagem clara
    }
  }
}
```

**Falha → rollback transação + abort do boot.** Mensagem clara em log + dialog Electron se rodou via UI.

---

## Helpers de seed (dev)

`db/seed-dev.ts` — popula DB com dados pra teste manual de UI sem rodar STT real. Cobre cenários do Roberto E2E e smoke manual.

```typescript
// db/seed-dev.ts (rodável via: npm run db:seed:dev)
import { ulid } from 'ulid';
import { getDb } from './db';

export function seedDev() {
  const db = getDb();

  // Settings padrão
  const defaults = [
    ['hotkey', '"Right Ctrl"'],
    ['stt_force_local', 'false'],
    ['stt_language', 'null'],
    ['auto_start', 'false'],
    ['overlay_position', '"br"'],
    ['smart_punctuation', 'true'],
    ['audio_retention_days', '30'],
    ['first_run_completed', 'true'],
    ['muted', 'false'],
    ['app_blacklist', '[]'],
    ['app_force_typing', '[]'],
  ];
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))');
  for (const [k, v] of defaults) stmt.run(k, v);

  // 3 transcrições exemplo
  const tx = db.prepare(`
    INSERT INTO transcription
    (id, ts, text, audio_path, app_exe, app_window_title, provider_used, slot_index, slot_label,
     latency_ms, duration_ms, language, vocab_corrections_applied, paste_method, paste_succeeded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date();
  const samples = [
    { text: 'isso é um teste do flowtype', app: 'notepad.exe', title: 'Sem título — Bloco de Notas',
      provider: 'groq', slot: 0, label: 'primary', latency: 720, dur: 2100, lang: 'pt-BR' },
    { text: 'reunião marcada para amanhã às quinze horas', app: 'claude.exe', title: 'Claude',
      provider: 'groq', slot: 1, label: 'backup', latency: 840, dur: 3400, lang: 'pt-BR' },
    { text: 'this is the offline fallback path', app: 'code.exe', title: 'VSCode',
      provider: 'local', slot: null, label: null, latency: 3200, dur: 2800, lang: 'en-US' },
  ];
  for (const s of samples) {
    tx.run(ulid(), new Date(now.getTime() - Math.random() * 86400000).toISOString(), s.text,
           null, s.app, s.title, s.provider, s.slot, s.label, s.latency, s.dur, s.lang, '[]',
           'clipboard', 1);
  }

  // 2 vocab entries pra teste do pipeline
  const vx = db.prepare(`
    INSERT INTO vocab_entry (id, term_wrong, term_correct, case_sensitive, scope)
    VALUES (?, ?, ?, ?, ?)
  `);
  vx.run(ulid(), 'kunha', 'Cunha', 0, 'global');
  vx.run(ulid(), 'js', 'JavaScript', 1, 'code.exe');

  console.log('[seed-dev] OK — 3 transcrições + 2 vocabs + settings padrão');
}
```

---

## Retenção e limpeza

| Dado | Default | Configurável (settings key) |
|------|---------|-----------------------------|
| `transcription` rows | 90 dias | `transcription_retention_days` (number, default 90) |
| Áudios `recordings/YYYY-MM-DD/*.opus` | 30 dias | `audio_retention_days` (number, default 30) |
| `token_usage` rows | 90 dias (snapshot histórico) | `token_usage_retention_days` (default 90) |
| `vocab_entry` | indefinido | — (curadoria manual via Settings) |
| `settings` | indefinido | — |
| `groq_slot_meta` | indefinido | — (3 rows fixas) |

**Job de cleanup** roda mensalmente (cron simples em `main/jobs/cleanup.ts`, primeiro dia do mês UTC + at app boot se `lastCleanup > 30 dias`):

```typescript
function cleanup() {
  const db = getDb();
  const trxDays = getSetting('transcription_retention_days', 90);
  const audioDays = getSetting('audio_retention_days', 30);
  const tokenDays = getSetting('token_usage_retention_days', 90);

  // 1. Deleta rows transcription + cascade no FTS via triggers
  const cutoffTx = new Date(Date.now() - trxDays * 86400000).toISOString();
  db.prepare('DELETE FROM transcription WHERE created_at < ?').run(cutoffTx);

  // 2. Deleta áudios no FS
  const cutoffAudio = new Date(Date.now() - audioDays * 86400000);
  const recordingsRoot = path.join(app.getPath('appData'), 'flowtype', 'recordings');
  for (const dateDir of readdirSync(recordingsRoot)) {
    if (new Date(dateDir) < cutoffAudio) {
      rmSync(path.join(recordingsRoot, dateDir), { recursive: true, force: true });
    }
  }

  // 3. Deleta token_usage antigos
  const cutoffTokens = format(subDays(new Date(), tokenDays), 'yyyy-MM-dd');
  db.prepare('DELETE FROM token_usage WHERE day < ?').run(cutoffTokens);

  setSetting('last_cleanup_at', new Date().toISOString());
}
```

**Nunca zera DB em rotina** (regra hard do owner): cleanup só remove rows expiradas; user fica responsável por backup da pasta `%APPDATA%/flowtype/`.

---

## Notas de capacidade

- `transcription` cresce ~1 row por hotkey-release. Estimativa 200 transcrições/dia × 90 dias = 18k rows. FTS5 + bm25 lidam tranquilamente (testado em playspeak com 5k+ rows).
- Áudio `.opus` ~12-25 KB por segundo (bitrate 32-64 kbps). 200 captures × 3s × 30 dias = ~540 MB. Aceitável; settings permite reduzir retenção pra usuários com pouco disco.
- `token_usage` cresce ~3 rows/dia (1 por slot ativo) × 90 dias = ~270 rows. Trivial.
- DB total esperado em uso pesado: < 50 MB após 90 dias.
