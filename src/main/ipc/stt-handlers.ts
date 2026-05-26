/**
 * IPC handlers para a camada STT. Cobre e2-stt-settings-provider + e2-groq-pool-config.
 *
 * Canais expostos:
 *   stt:get-provider-settings     → { stt_force_local, stt_language, slots: PoolSnapshot }
 *   stt:set-force-local           → atualiza settings.stt_force_local
 *   stt:set-language              → atualiza settings.stt_language
 *   stt:test-transcribe           → roda cascade inline e retorna CascadeResult
 *
 *   stt:add-slot                  → validateGroqKey + upsert
 *   stt:update-slot               → re-validate + upsert
 *   stt:remove-slot               → clearSlot
 *   stt:test-slot                 → validateGroqKey de slot existente
 *
 * Registrar via registerSttIpcHandlers() chamado em src/main/index.ts ou
 * dentro de ipc-router.ts. Mantemos o módulo independente pra não criar
 * cyclic deps com o router WO-1.
 */

import { ipcMain } from 'electron';
import { logger } from '../utils/logger.js';
import type { GroqKeyPool } from '../stt/groq-key-pool.js';
import type { SttGateway } from '../stt/stt-gateway.js';
import type { SettingsRepo } from '../repos/settings-repo.js';
import { validateGroqKey } from '../stt/validate-groq-key.js';
import type { PoolSnapshot, ValidateKeyResult } from '../stt/stt-types.js';

export const SttChannels = {
  GetProviderSettings: 'stt:get-provider-settings',
  SetForceLocal: 'stt:set-force-local',
  SetLanguage: 'stt:set-language',
  TestTranscribe: 'stt:test-transcribe',
  AddSlot: 'stt:add-slot',
  UpdateSlot: 'stt:update-slot',
  RemoveSlot: 'stt:remove-slot',
  TestSlot: 'stt:test-slot',
  PoolSnapshot: 'stt:pool-snapshot',
} as const;

export interface AddSlotPayload {
  slotIndex: 0 | 1 | 2;
  apiKey: string;
  label?: string;
  dailyCap?: number;
}

export interface RemoveSlotPayload {
  slotIndex: 0 | 1 | 2;
}

export interface TestSlotPayload {
  slotIndex: 0 | 1 | 2;
}

export interface TestTranscribePayload {
  audio: ArrayBuffer;
  language?: string;
}

export interface ProviderSettingsResponse {
  stt_force_local: boolean;
  stt_language: string | null;
  slots: PoolSnapshot;
}

export interface SttIpcDeps {
  pool: GroqKeyPool;
  gateway: SttGateway;
  settings: SettingsRepo;
  /** Override pra testes — default usa global fetch. */
  validateFn?: typeof validateGroqKey;
}

export function registerSttIpcHandlers(deps: SttIpcDeps): void {
  const validate = deps.validateFn ?? validateGroqKey;

  ipcMain.handle(SttChannels.GetProviderSettings, (): ProviderSettingsResponse => {
    return {
      stt_force_local: deps.settings.get<boolean>('stt_force_local', false),
      stt_language: deps.settings.get<string | null>('stt_language', null),
      slots: deps.pool.snapshot(),
    };
  });

  ipcMain.handle(SttChannels.SetForceLocal, (_e, enabled: boolean) => {
    deps.settings.set('stt_force_local', !!enabled);
    return { ok: true };
  });

  ipcMain.handle(SttChannels.SetLanguage, (_e, language: string | null) => {
    deps.settings.set('stt_language', language ?? null);
    return { ok: true };
  });

  ipcMain.handle(SttChannels.PoolSnapshot, (): PoolSnapshot => deps.pool.snapshot());

  ipcMain.handle(SttChannels.TestTranscribe, async (_e, payload: TestTranscribePayload) => {
    return deps.gateway.transcribe(payload.audio, { language: payload.language });
  });

  ipcMain.handle(
    SttChannels.AddSlot,
    async (_e, payload: AddSlotPayload): Promise<{
      ok: boolean;
      validation: ValidateKeyResult;
    }> => {
      const validation = await validate(payload.apiKey);
      if (!validation.valid) {
        logger.warn({
          event: 'stt.add_slot.validation_failed',
          slot: payload.slotIndex,
          error: validation.error,
        });
        // Salva a key + label mas marca status='invalid' pra UI poder mostrar.
        deps.pool.setSlot(payload.slotIndex, {
          apiKey: payload.apiKey,
          label: payload.label ?? null,
          dailyCap: payload.dailyCap,
          validationOk: false,
        });
        deps.pool.markInvalid(payload.slotIndex);
        return { ok: false, validation };
      }
      deps.pool.setSlot(payload.slotIndex, {
        apiKey: payload.apiKey,
        label: payload.label ?? null,
        dailyCap: payload.dailyCap,
        validationOk: true,
      });
      if (validation.shouldMarkExhausted) {
        deps.pool.markExhausted(payload.slotIndex);
      }
      return { ok: true, validation };
    },
  );

  ipcMain.handle(SttChannels.UpdateSlot, async (_e, payload: AddSlotPayload) => {
    const validation = await validate(payload.apiKey);
    deps.pool.setSlot(payload.slotIndex, {
      apiKey: payload.apiKey,
      label: payload.label ?? null,
      dailyCap: payload.dailyCap,
      validationOk: validation.valid,
    });
    if (validation.valid && validation.shouldMarkExhausted) {
      deps.pool.markExhausted(payload.slotIndex);
    } else if (!validation.valid) {
      deps.pool.markInvalid(payload.slotIndex);
    }
    return { ok: validation.valid, validation };
  });

  ipcMain.handle(SttChannels.RemoveSlot, (_e, payload: RemoveSlotPayload) => {
    deps.pool.clearSlot(payload.slotIndex);
    return { ok: true };
  });

  ipcMain.handle(
    SttChannels.TestSlot,
    async (_e, payload: TestSlotPayload): Promise<ValidateKeyResult> => {
      const snap = deps.pool.snapshot();
      const slot = snap.slots.find((s) => s.slotIndex === payload.slotIndex);
      if (!slot || !slot.hasKey) {
        return { valid: false, error: 'Slot vazio', latencyMs: 0 };
      }
      // Pega o api key real do repo (snapshot não traz a key por segurança).
      // Pool não expõe key diretamente — usamos um "test" round-robin restrito.
      // Simplificação: re-busca via interno do pool (privado seria melhor;
      // alternativa: GroqSlotMetaRepo é injetado lá, mas pra MVP do handler
      // usamos pool.next() até bater no slot certo — porém isso polui round-robin.
      // Melhor: expor método dedicado no pool.
      const apiKey = (await getSlotApiKey(deps.pool, payload.slotIndex)) ?? '';
      const result = await validate(apiKey);
      if (result.valid) {
        deps.pool.markOnline(payload.slotIndex);
        if (result.shouldMarkExhausted) deps.pool.markExhausted(payload.slotIndex);
      } else {
        deps.pool.markInvalid(payload.slotIndex);
      }
      return result;
    },
  );

  logger.info({
    event: 'stt.ipc.handlers_registered',
    channels: Object.values(SttChannels),
  });
}

/**
 * Helper: extrai api key bruta de um slot específico SEM consumir o
 * ponteiro round-robin (usado pra test-slot). Encapsulamento defensivo.
 */
async function getSlotApiKey(pool: GroqKeyPool, slotIndex: 0 | 1 | 2): Promise<string | null> {
  // pool.snapshot() não expõe key por segurança; usamos o repo interno via
  // `__slotsRepo` — exposto via property name controlada no pool.
  // Em vez disso, anexamos um método público getSlotApiKey no pool (ver groq-key-pool.ts).
  return pool.getSlotApiKey(slotIndex);
}
