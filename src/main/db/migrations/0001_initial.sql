-- 0001_initial.sql
-- flowtype v0.1 — schema base
-- Cobre features e6-* (schema, FTS5, vocab, settings, token_usage, groq_slot_meta).
-- Idempotente: usa CREATE TABLE IF NOT EXISTS quando seguro; CREATE TRIGGER e
-- CREATE VIRTUAL TABLE usam IF NOT EXISTS pra rerun seguro.

BEGIN;

-- ─── transcription (core) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transcription (
  id                          TEXT PRIMARY KEY,
  ts                          TEXT NOT NULL,
  text                        TEXT NOT NULL,
  audio_path                  TEXT,
  app_exe                     TEXT,
  app_window_title            TEXT,
  app_field_type              TEXT,
  provider_used               TEXT NOT NULL,
  slot_index                  INTEGER,
  slot_label                  TEXT,
  latency_ms                  INTEGER NOT NULL DEFAULT 0,
  duration_ms                 INTEGER NOT NULL DEFAULT 0,
  language                    TEXT,
  vocab_corrections_applied   TEXT NOT NULL DEFAULT '[]',
  paste_method                TEXT NOT NULL DEFAULT 'clipboard',
  paste_succeeded             INTEGER NOT NULL DEFAULT 1,
  target_window_lost_focus    INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (provider_used IN ('groq', 'local')),
  CHECK (paste_method IN ('clipboard', 'typing'))
);

CREATE INDEX IF NOT EXISTS idx_transcription_ts        ON transcription(ts DESC);
CREATE INDEX IF NOT EXISTS idx_transcription_app_exe   ON transcription(app_exe);
CREATE INDEX IF NOT EXISTS idx_transcription_provider  ON transcription(provider_used, ts DESC);

-- ─── transcription_fts (FTS5) ─────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS transcription_fts USING fts5(
  text,
  content='transcription',
  content_rowid='rowid',
  tokenize = 'porter unicode61 remove_diacritics 2'
);

-- Triggers AFTER (não BEFORE) — ver data-model.md §transcription_fts pra justificativa.
DROP TRIGGER IF EXISTS transcription_ai;
CREATE TRIGGER transcription_ai AFTER INSERT ON transcription BEGIN
  INSERT INTO transcription_fts(rowid, text) VALUES (new.rowid, new.text);
END;

DROP TRIGGER IF EXISTS transcription_ad;
CREATE TRIGGER transcription_ad AFTER DELETE ON transcription BEGIN
  INSERT INTO transcription_fts(transcription_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

DROP TRIGGER IF EXISTS transcription_au;
CREATE TRIGGER transcription_au AFTER UPDATE OF text ON transcription BEGIN
  INSERT INTO transcription_fts(transcription_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO transcription_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- ─── vocab_entry ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vocab_entry (
  id              TEXT PRIMARY KEY,
  term_wrong      TEXT NOT NULL,
  term_correct    TEXT NOT NULL,
  case_sensitive  INTEGER NOT NULL DEFAULT 0,
  scope           TEXT NOT NULL DEFAULT 'global',
  times_applied   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (length(term_wrong) > 0),
  CHECK (length(term_correct) > 0)
);

CREATE INDEX IF NOT EXISTS idx_vocab_scope ON vocab_entry(scope);

-- ─── settings (key-value JSON) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── token_usage ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS token_usage (
  id                    TEXT PRIMARY KEY,
  provider              TEXT NOT NULL,
  slot_index            INTEGER NOT NULL,
  slot_label            TEXT,
  day                   TEXT NOT NULL,
  requests_count        INTEGER NOT NULL DEFAULT 0,
  last_used_at          TEXT,
  marked_exhausted_at   TEXT,
  marked_invalid_at     TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(provider, slot_index, day)
);

CREATE INDEX IF NOT EXISTS idx_token_usage_provider_day ON token_usage(provider, day);
CREATE INDEX IF NOT EXISTS idx_token_usage_slot_day     ON token_usage(slot_index, day);

-- ─── groq_slot_meta ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groq_slot_meta (
  slot_index          INTEGER PRIMARY KEY,
  api_key_encrypted   TEXT,
  label               TEXT,
  daily_cap           INTEGER NOT NULL DEFAULT 14400,
  added_at            TEXT,
  last_validated_at   TEXT,
  validation_status   TEXT NOT NULL DEFAULT 'untested',

  CHECK (slot_index IN (0, 1, 2)),
  CHECK (validation_status IN ('online', 'invalid', 'untested')),
  CHECK (daily_cap > 0)
);

-- Seed dos 3 slots Groq vazios (rows fixas; UI só preenche api_key).
INSERT OR IGNORE INTO groq_slot_meta (slot_index, daily_cap, validation_status) VALUES
  (0, 14400, 'untested'),
  (1, 14400, 'untested'),
  (2, 14400, 'untested');

COMMIT;
