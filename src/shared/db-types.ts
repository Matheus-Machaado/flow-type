/**
 * Tipos compartilhados pra entidades persistidas em SQLite.
 * Espelham as tabelas definidas em src/main/db/migrations/0001_initial.sql.
 * Cobre features e6-* (data-model.md).
 */

// ─── transcription ─────────────────────────────────────────────────────

export type ProviderUsed = 'groq' | 'local';
export type PasteMethod = 'clipboard' | 'typing';

export interface VocabCorrectionApplied {
  wrong: string;
  correct: string;
  scope: string;
}

export interface Transcription {
  id: string;
  ts: string;
  text: string;
  audio_path: string | null;
  app_exe: string | null;
  app_window_title: string | null;
  app_field_type: string | null;
  provider_used: ProviderUsed;
  slot_index: number | null;
  slot_label: string | null;
  latency_ms: number;
  duration_ms: number;
  language: string | null;
  vocab_corrections_applied: VocabCorrectionApplied[];
  paste_method: PasteMethod;
  paste_succeeded: boolean;
  target_window_lost_focus: boolean;
  created_at: string;
}

export interface TranscriptionInsertInput {
  id?: string;
  ts?: string;
  text: string;
  audio_path?: string | null;
  app_exe?: string | null;
  app_window_title?: string | null;
  app_field_type?: string | null;
  provider_used: ProviderUsed;
  slot_index?: number | null;
  slot_label?: string | null;
  latency_ms?: number;
  duration_ms?: number;
  language?: string | null;
  vocab_corrections_applied?: VocabCorrectionApplied[];
  paste_method?: PasteMethod;
  paste_succeeded?: boolean;
  target_window_lost_focus?: boolean;
}

export interface TranscriptionListFilters {
  dateFrom?: string;
  dateTo?: string;
  appExe?: string[];
  provider?: ProviderUsed;
}

export interface TranscriptionSearchOptions {
  filters?: TranscriptionListFilters;
  limit?: number;
  offset?: number;
}

// ─── vocab_entry ───────────────────────────────────────────────────────

export interface VocabEntry {
  id: string;
  term_wrong: string;
  term_correct: string;
  case_sensitive: boolean;
  scope: string;
  times_applied: number;
  created_at: string;
  updated_at: string;
}

export interface VocabEntryInput {
  id?: string;
  term_wrong: string;
  term_correct: string;
  case_sensitive?: boolean;
  scope?: string;
}

export interface VocabEntryUpdate {
  term_wrong?: string;
  term_correct?: string;
  case_sensitive?: boolean;
  scope?: string;
}

// ─── settings ──────────────────────────────────────────────────────────

export interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

export const SETTINGS_DEFAULTS: Record<string, unknown> = {
  hotkey: 'Right Ctrl',
  hotkey_hold_min_ms: 300,
  stt_force_local: false,
  stt_language: null,
  auto_start: false,
  first_run_completed: false,
  muted: false,
  overlay_position: 'br',
  overlay_idle_opacity: 0.3,
  smart_punctuation: true,
  punctuation_smart_enabled: true,
  app_blacklist: [],
  app_force_typing: [],
  injection_method_default: 'clipboard',
  injection_method_overrides: { 'keepass.exe': 'typing', '1password.exe': 'typing' },
  injection_blacklist: [],
  transcription_retention_days: 90,
  audio_retention_days: 30,
  token_usage_retention_days: 90,
  telemetry_enabled: false,
};

// ─── token_usage ───────────────────────────────────────────────────────

export interface TokenUsage {
  id: string;
  provider: string;
  slot_index: number;
  slot_label: string | null;
  day: string;
  requests_count: number;
  last_used_at: string | null;
  marked_exhausted_at: string | null;
  marked_invalid_at: string | null;
  created_at: string;
}

// ─── groq_slot_meta ────────────────────────────────────────────────────

export type GroqValidationStatus = 'online' | 'invalid' | 'untested';

export interface GroqSlotMeta {
  slot_index: 0 | 1 | 2;
  api_key_encrypted: string | null;
  label: string | null;
  daily_cap: number;
  added_at: string | null;
  last_validated_at: string | null;
  validation_status: GroqValidationStatus;
}

export interface GroqSlotMetaUpsert {
  api_key_encrypted?: string | null;
  label?: string | null;
  daily_cap?: number;
  validation_status?: GroqValidationStatus;
}
