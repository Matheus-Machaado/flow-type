/**
 * SttGateway — orquestra cascade STT em 2 níveis (e2-stt-cascade-fallback, ADR-06).
 *
 *   Nível 1 — intra-Groq:
 *     while pool.onlineCount() > 0:
 *       tenta groqProvider.transcribe (que escolhe próximo slot via pool.next())
 *       429 → markExhausted + retry IMEDIATO próximo slot
 *       401 → markInvalid    + retry IMEDIATO próximo slot
 *       timeout 1x mesmo slot → retry
 *       timeout 2x → cai pra nível 2 SEM marcar exhausted
 *
 *   Nível 2 — fallback local:
 *     localProvider.transcribe (faster-whisper)
 *     se falhar → throw SttCompleteFailureError com attempts[]
 *
 *   Flag `settings.stt_force_local=true` pula nível 1 inteiro.
 *
 * Telemetria:
 *   - attempts[] cronológico em CascadeResult
 *   - keyRotationCount (trocas de slot DENTRO do nível 1)
 *   - emite evento `overlay:badge` via broadcaster opcional
 *   - log estruturado `groq.rotation` em cada troca de slot
 *   - log `transcription.completed` no final
 */

import type { SettingsRepo } from '../repos/settings-repo.js';
import type { VocabRepo } from '../repos/vocab-repo.js';
import { logger } from '../utils/logger.js';
import { applyVocabCorrections, type VocabApplied } from './vocab-applier.js';
import type { FasterWhisperLocalProvider } from './faster-whisper-local-provider.js';
import type { GroqKeyPool } from './groq-key-pool.js';
import type { GroqProvider } from './groq-provider.js';
import {
  GroqAuthError,
  GroqOfflineError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqUnknownError,
  LocalUnavailableError,
  PoolEmptyError,
  SttCompleteFailureError,
  type CascadeAttempt,
  type CascadeResult,
  type OverlayBadgeEvent,
  type TranscribeOptions,
} from './stt-types.js';

const DEFAULT_BADGE_TTL_MS = 1500;
const TIMEOUT_RETRY_PER_SLOT = 1; // 1ª tentativa + 1 retry = 2 tentativas totais.

export type OverlayBroadcaster = (event: OverlayBadgeEvent) => void;

/**
 * Hook pós-transcrição com sucesso. Recebe o CascadeResult final + o tempo de
 * início (t0) pra permitir cálculo de wall-clock. Usado pelo wiring de boot
 * pra ligar SttGateway → TextInjector → TranscriptionRepo (WO-3).
 *
 * Erros do hook são logados mas NÃO derrubam o resultado da transcribe.
 */
export type SttPostTranscribeHook = (
  result: CascadeResult,
  ctx: { t0: number; now: number },
) => Promise<void> | void;

export interface SttGatewayOptions {
  /** Emite overlay:badge após transcribe (WO-4 renderiza o badge). */
  broadcastBadge?: OverlayBroadcaster;
  /** Override do clock pra testes. */
  now?: () => number;
  /** TTL do badge em ms. Default 1500. */
  badgeTtlMs?: number;
  /**
   * Hook pós-sucesso (WO-3 wiring): chama textInjector.paste + grava
   * transcription_repo.insert. Best-effort: erros logados, não throw.
   */
  onTranscribed?: SttPostTranscribeHook;
  /**
   * Vocab repo (WO-4 e4-vocab-correction-pipeline). Quando presente,
   * aplica correções pós-STT antes de retornar o CascadeResult.
   * Estende o tipo de retorno informalmente com `vocab_corrections_applied`
   * via casting no consumer (TranscriptionRepo).
   */
  vocabRepo?: VocabRepo;
  /**
   * Resolve nome do app ativo pra escopo vocab (`scope=appExe`). Best-effort:
   * default = sem scope (só globals).
   */
  resolveActiveExe?: () => string | undefined;
}

export class SttGateway {
  private readonly broadcastBadge?: OverlayBroadcaster;
  private readonly now: () => number;
  private readonly badgeTtlMs: number;
  private readonly onTranscribed?: SttPostTranscribeHook;
  private readonly vocabRepo?: VocabRepo;
  private readonly resolveActiveExe?: () => string | undefined;

  constructor(
    private readonly groqProvider: GroqProvider,
    private readonly localProvider: FasterWhisperLocalProvider,
    private readonly pool: GroqKeyPool,
    private readonly settings: SettingsRepo,
    opts: SttGatewayOptions = {},
  ) {
    this.broadcastBadge = opts.broadcastBadge;
    this.now = opts.now ?? (() => Date.now());
    this.badgeTtlMs = opts.badgeTtlMs ?? DEFAULT_BADGE_TTL_MS;
    this.onTranscribed = opts.onTranscribed;
    this.vocabRepo = opts.vocabRepo;
    this.resolveActiveExe = opts.resolveActiveExe;
  }

  /**
   * Aplica correções vocab pós-STT no `text` do CascadeResult.
   * Best-effort: erros do repo ou regex são logados mas não derrubam
   * o resultado. Anexa `vocab_corrections_applied` ao result via type cast
   * (consumer lê pra persistir em transcription_repo).
   */
  private applyVocabIfAvailable(result: CascadeResult): CascadeResult {
    if (!this.vocabRepo || !result.text) return result;
    try {
      const exe = this.resolveActiveExe?.();
      const entries = this.vocabRepo.getByScope(exe);
      if (entries.length === 0) return result;
      const { text, applied } = applyVocabCorrections(result.text, entries);
      if (applied.length === 0) return result;
      for (const a of applied) {
        try {
          this.vocabRepo.incrementTimesApplied(a.id, a.count);
        } catch (e) {
          logger.warn({
            event: 'vocab.increment_failed',
            id: a.id,
            error: (e as Error).message,
          });
        }
      }
      const out = { ...result, text } as CascadeResult & {
        vocab_corrections_applied: VocabApplied[];
      };
      out.vocab_corrections_applied = applied;
      return out;
    } catch (e) {
      logger.warn({
        event: 'vocab.apply_failed',
        error: (e as Error).message,
      });
      return result;
    }
  }

  /**
   * Roda a cascade completa. Sempre retorna CascadeResult OU lança
   * SttCompleteFailureError se ambos níveis falharem.
   */
  async transcribe(
    audio: ArrayBuffer,
    opts: TranscribeOptions = {},
  ): Promise<CascadeResult> {
    const attempts: CascadeAttempt[] = [];

    const forceLocal = this.settings.get<boolean>('stt_force_local', false) === true;

    if (!forceLocal) {
      // ── Nível 1: rotação intra-Groq ─────────────────────────────────
      // Calcula slot count NO START (deduplicado abaixo via try/catch).
      const initialOnline = this.pool.onlineCount();
      let timeoutsForCurrentSlot = 0;
      let lastSlot: number | null = null;
      let fellThroughTimeout = false;

      // Limite de tentativas no nível 1: cada slot online tem direito a
      // (1 + TIMEOUT_RETRY_PER_SLOT) tentativas. Cap absoluto = (initial × 2)
      // para evitar loop infinito caso o pool seja repopulado durante o turno.
      const maxAttempts = Math.max(1, initialOnline) * (1 + TIMEOUT_RETRY_PER_SLOT) + 1;

      for (let i = 0; i < maxAttempts; i++) {
        if (this.pool.allUnavailable()) break;
        try {
          const t0 = this.now();
          const result = await this.groqProvider.transcribe(audio, opts);
          attempts.push({
            slotIndex: result.slotIndex,
            slotLabel: result.slotLabel,
            provider: 'groq',
            latencyMs: result.latencyMs,
            status: 'ok',
          });

          const cascadeResult0: CascadeResult = {
            ...result,
            fellBack: false,
            attempts,
            keyRotationCount: this.computeKeyRotationCount(attempts),
          };
          const cascadeResult = this.applyVocabIfAvailable(cascadeResult0);
          this.emitBadge(cascadeResult);
          this.logCompleted(cascadeResult, t0);
          if (!opts.skipPostHook) await this.runPostHook(cascadeResult, t0);
          return cascadeResult;
        } catch (err) {
          const errSlot = (err as { slotIndex?: number }).slotIndex;
          const latencyMs = (err as { latencyMs?: number }).latencyMs ?? 0;

          if (err instanceof PoolEmptyError) {
            // Pool ficou vazio entre o snapshot e a chamada — cai pro local.
            attempts.push({
              provider: 'groq',
              errorCode: err.code,
              errorMessage: err.message,
              latencyMs,
              status: 'error',
            });
            break;
          }

          if (err instanceof GroqAuthError || err instanceof GroqRateLimitError) {
            attempts.push({
              slotIndex: errSlot,
              provider: 'groq',
              errorCode: err.code,
              errorMessage: err.message,
              latencyMs,
              status: 'error',
            });
            this.logRotation({
              fromSlot: errSlot ?? lastSlot,
              toSlot: this.peekNextSlot(),
              reason: err instanceof GroqAuthError ? '401' : '429',
              attemptInTurn: attempts.length,
            });
            lastSlot = errSlot ?? lastSlot;
            timeoutsForCurrentSlot = 0;
            continue;
          }

          if (err instanceof GroqTimeoutError) {
            attempts.push({
              slotIndex: errSlot,
              provider: 'groq',
              errorCode: err.code,
              errorMessage: err.message,
              latencyMs,
              status: 'error',
            });
            if (errSlot !== undefined && errSlot === lastSlot) {
              timeoutsForCurrentSlot++;
            } else {
              timeoutsForCurrentSlot = 1;
            }
            lastSlot = errSlot ?? lastSlot;

            if (timeoutsForCurrentSlot > TIMEOUT_RETRY_PER_SLOT) {
              // Falhou TIMEOUT_RETRY_PER_SLOT vezes no mesmo slot → fallback local sem marcar.
              this.logRotation({
                fromSlot: errSlot ?? null,
                toSlot: null,
                reason: 'timeout',
                attemptInTurn: attempts.length,
              });
              fellThroughTimeout = true;
              break;
            }
            // Mantém mesmo slot pra retry — mas pool.next() vai retornar o
            // PRÓXIMO no round-robin. Como retry no mesmo slot é difícil
            // garantir sem reaver o ponteiro, optamos por seguir rotação:
            // simples e previsível. (Trade-off documentado.)
            continue;
          }

          if (err instanceof GroqOfflineError) {
            attempts.push({
              slotIndex: errSlot,
              provider: 'groq',
              errorCode: err.code,
              errorMessage: err.message,
              latencyMs,
              status: 'error',
            });
            // Network down → cai pro local imediatamente.
            this.logRotation({
              fromSlot: errSlot ?? null,
              toSlot: null,
              reason: 'pool_empty',
              attemptInTurn: attempts.length,
            });
            break;
          }

          if (err instanceof GroqUnknownError) {
            attempts.push({
              slotIndex: errSlot,
              provider: 'groq',
              errorCode: err.code,
              errorMessage: err.message,
              latencyMs,
              status: 'error',
            });
            // 5xx/4xx desconhecido — tenta próximo slot uma vez, depois cai.
            lastSlot = errSlot ?? lastSlot;
            continue;
          }

          // Erro inesperado: log e propaga via fallback local.
          logger.error({
            event: 'stt.gateway.unexpected_groq_error',
            error: (err as Error).message,
          });
          attempts.push({
            slotIndex: errSlot,
            provider: 'groq',
            errorCode: 'UNEXPECTED',
            errorMessage: (err as Error).message,
            latencyMs,
            status: 'error',
          });
          break;
        }
      }

      // Marcador útil em testes (não usado p/ ramificação atual mas pode entrar em telemetria futura).
      void fellThroughTimeout;
    }

    // ── Nível 2: fallback local ─────────────────────────────────────
    try {
      const t0 = this.now();
      const result = await this.localProvider.transcribe(audio, opts);
      attempts.push({
        provider: 'local',
        latencyMs: result.latencyMs,
        status: 'ok',
      });
      const cascadeResult0: CascadeResult = {
        ...result,
        fellBack: !forceLocal,
        attempts,
        keyRotationCount: this.computeKeyRotationCount(attempts),
      };
      const cascadeResult = this.applyVocabIfAvailable(cascadeResult0);
      this.emitBadge(cascadeResult);
      this.logCompleted(cascadeResult, t0);
      await this.runPostHook(cascadeResult, t0);
      return cascadeResult;
    } catch (err) {
      attempts.push({
        provider: 'local',
        errorCode: (err as { code?: string }).code ?? 'UNKNOWN',
        errorMessage: (err as Error).message,
        latencyMs: 0,
        status: 'error',
      });
      const isExpected =
        err instanceof LocalUnavailableError ||
        err instanceof GroqTimeoutError; // local timeout reusa erro
      logger.error({
        event: 'stt.gateway.complete_failure',
        attempts,
        force_local: forceLocal,
        local_error: (err as Error).message,
        expected: isExpected,
      });
      throw new SttCompleteFailureError(
        `STT cascade falhou em ambos níveis: ${(err as Error).message}`,
        attempts,
      );
    }
  }

  /**
   * keyRotationCount = número de transições entre slots Groq distintos durante o turno.
   * Para uma sequência de attempts groq com slots [0, 1, 2] (independente de ok/error),
   * a contagem é 2 (transitions: 0→1, 1→2).
   *
   * Cobre o caso brief: "3 attempts: slot#0 429 → slot#1 401 → slot#2 200 ⇒ keyRotationCount=2".
   */
  private computeKeyRotationCount(attempts: CascadeAttempt[]): number {
    let count = 0;
    let prevSlot: number | null = null;
    for (const a of attempts) {
      if (a.provider !== 'groq') continue;
      if (a.slotIndex === undefined) continue;
      if (prevSlot !== null && a.slotIndex !== prevSlot) {
        count++;
      }
      prevSlot = a.slotIndex;
    }
    return count;
  }

  // ─── Telemetria + side-effects ────────────────────────────────────

  private emitBadge(result: CascadeResult): void {
    if (!this.broadcastBadge) return;
    this.broadcastBadge({
      kind: result.provider,
      slotIndex: result.slotIndex,
      slotLabel: result.slotLabel,
      latencyMs: result.latencyMs,
      ttlMs: this.badgeTtlMs,
    });
  }

  private logCompleted(result: CascadeResult, t0: number): void {
    logger.info({
      event: 'transcription.completed',
      provider_used: result.provider,
      slot_index: result.slotIndex,
      slot_label: result.slotLabel,
      latency_ms: result.latencyMs,
      total_wall_ms: this.now() - t0,
      fell_back: result.fellBack,
      key_rotation_count: result.keyRotationCount,
      attempts: result.attempts.length,
      text_chars: result.text.length,
    });
  }

  private logRotation(input: {
    fromSlot: number | null;
    toSlot: number | null;
    reason: '429' | '401' | 'timeout' | 'pool_empty';
    attemptInTurn: number;
  }): void {
    logger.info({
      event: 'groq.rotation',
      from_slot: input.fromSlot,
      to_slot: input.toSlot,
      reason: input.reason,
      attempt_in_turn: input.attemptInTurn,
    });
  }

  /**
   * Roda hook pós-transcrição com sucesso. Best-effort: erros são logados
   * mas não propagam (a transcribe já tem sucesso; falhar no inject/insert
   * não pode invalidar isso).
   */
  private async runPostHook(result: CascadeResult, t0: number): Promise<void> {
    if (!this.onTranscribed) return;
    try {
      await this.onTranscribed(result, { t0, now: this.now() });
    } catch (err) {
      logger.error({
        event: 'stt.gateway.post_hook_failed',
        error: (err as Error).message,
      });
    }
  }

  /** Espia o próximo slot sem consumir (best-effort: catch PoolEmpty). */
  private peekNextSlot(): number | null {
    try {
      // O ponteiro avança SOMENTE em next() (não em snapshot), mas o efeito do
      // peek é "espia o que viria após eventual chamada agora" — boa o suficiente.
      const snap = this.pool.snapshot();
      const onlineSlots = snap.slots.filter((s) => s.status === 'online');
      if (onlineSlots.length === 0) return null;
      return onlineSlots[0].slotIndex;
    } catch {
      return null;
    }
  }
}
