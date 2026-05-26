/**
 * Daily cleanup job.
 *
 * Cobre e6-job-daily-cleanup:
 *   - Apaga transcription.created_at < hoje - 90 dias
 *   - Apaga áudios em recordings/YYYY-MM-DD/ > 30 dias
 *   - TokenUsageRepo.resetDaily() (limpa exhausted; mantém invalid)
 *   - Log estruturado
 *
 * Programado para 02:00 local diariamente. Implementação leve via setTimeout
 * (sem dependência node-cron — playspeak também usa setTimeout-based).
 * Também roda no boot do app se `last_cleanup_at > 1 dia` em settings.
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TranscriptionRepo } from '../repos/transcription-repo.js';
import type { TokenUsageRepo } from '../repos/token-usage-repo.js';
import type { SettingsRepo } from '../repos/settings-repo.js';
import { getRecordingsRoot } from '../utils/audio-path.js';
import { logger } from '../utils/logger.js';

export interface DailyCleanupDeps {
  transcriptionRepo: TranscriptionRepo;
  tokenUsageRepo: TokenUsageRepo;
  settingsRepo: SettingsRepo;
  recordingsRoot?: string;
  /** Override do "now" pra testes. */
  now?: () => Date;
}

export interface CleanupResult {
  rowsRemoved: number;
  filesRemoved: number;
  slotsReset: number;
  tokenUsageRowsRemoved: number;
}

/**
 * Roda o cleanup uma vez. Síncrono, idempotente. Logs estruturados.
 */
export function runDailyCleanup(deps: DailyCleanupDeps): CleanupResult {
  const now = (deps.now ?? (() => new Date()))();
  const settings = deps.settingsRepo;
  const trxDays = settings.get<number>('transcription_retention_days', 90);
  const audioDays = settings.get<number>('audio_retention_days', 30);
  const tokenDays = settings.get<number>('token_usage_retention_days', 90);

  // 1. Transcriptions antigas (FTS sincroniza via trigger).
  const rowsRemoved = deps.transcriptionRepo.deleteOlderThan(trxDays);

  // 2. Áudios no FS.
  const root = deps.recordingsRoot ?? getRecordingsRoot();
  const filesRemoved = sweepAudioDirs(root, audioDays, now);

  // 3. Reset diário do pool (zera exhausted).
  const slotsReset = deps.tokenUsageRepo.resetDaily();

  // 4. Cleanup histórico token_usage.
  const tokenUsageRowsRemoved = deps.tokenUsageRepo.cleanup(tokenDays);

  // 5. Marca timestamp da última execução.
  settings.set('last_cleanup_at', now.toISOString());

  logger.info({
    event: 'cleanup.completed',
    rowsRemoved,
    filesRemoved,
    slotsReset,
    tokenUsageRowsRemoved,
  });

  return { rowsRemoved, filesRemoved, slotsReset, tokenUsageRowsRemoved };
}

/**
 * Remove diretórios `recordings/YYYY-MM-DD` cujo "dia" seja mais antigo que
 * `days`. Retorna nº de arquivos `.opus` removidos (estimativa via contagem
 * antes de remover o diretório).
 */
function sweepAudioDirs(root: string, days: number, now: Date): number {
  if (!existsSync(root)) return 0;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  let removed = 0;

  let dateDirs: string[];
  try {
    dateDirs = readdirSync(root);
  } catch (err) {
    logger.warn({
      event: 'cleanup.audio.read_failed',
      root,
      error: (err as Error).message,
    });
    return 0;
  }

  for (const name of dateDirs) {
    const dirPath = join(root, name);
    if (!isDateDir(name)) continue;
    const dirDate = new Date(`${name}T00:00:00Z`);
    if (Number.isNaN(dirDate.getTime())) continue;
    if (dirDate >= cutoff) continue;

    try {
      const st = statSync(dirPath);
      if (!st.isDirectory()) continue;
      const files = readdirSync(dirPath).filter((f) => f.endsWith('.opus'));
      rmSync(dirPath, { recursive: true, force: true });
      removed += files.length;
      logger.debug({ event: 'cleanup.audio.dir_removed', dir: name, files: files.length });
    } catch (err) {
      logger.warn({
        event: 'cleanup.audio.dir_remove_failed',
        dir: name,
        error: (err as Error).message,
      });
    }
  }
  return removed;
}

function isDateDir(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(name);
}

/**
 * Schedule simples: chama cb diariamente às 02:00 local. Retorna função pra cancelar.
 * Usar em conjunto com `runDailyCleanup` no main process.
 */
export function scheduleDailyAt2am(cb: () => void): () => void {
  let cancelled = false;
  let timeout: NodeJS.Timeout | undefined;

  const schedule = () => {
    if (cancelled) return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    timeout = setTimeout(() => {
      try {
        cb();
      } catch (err) {
        logger.error({
          event: 'cleanup.scheduled.failed',
          error: (err as Error).message,
        });
      }
      schedule();
    }, delay);
  };

  schedule();

  return () => {
    cancelled = true;
    if (timeout) clearTimeout(timeout);
  };
}
