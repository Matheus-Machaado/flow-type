/**
 * Boot helper: monta GroqKeyPool + GroqProvider + FasterWhisperLocalProvider
 * + SttGateway com dependências injetadas. Chamado em src/main/index.ts.
 */

import type { SettingsRepo } from '../repos/settings-repo.js';
import type { GroqSlotMetaRepo } from '../repos/groq-slot-meta-repo.js';
import type { TokenUsageRepo } from '../repos/token-usage-repo.js';
import { FasterWhisperLocalProvider, type FasterWhisperLocalProviderOptions } from './faster-whisper-local-provider.js';
import { GroqKeyPool } from './groq-key-pool.js';
import { GroqProvider, type GroqProviderOptions } from './groq-provider.js';
import { SttGateway, type OverlayBroadcaster, type SttGatewayOptions } from './stt-gateway.js';

export interface BuildSttStackOptions {
  groqOptions?: GroqProviderOptions;
  localOptions?: FasterWhisperLocalProviderOptions;
  gatewayOptions?: SttGatewayOptions;
  broadcastBadge?: OverlayBroadcaster;
}

export interface SttStack {
  pool: GroqKeyPool;
  groqProvider: GroqProvider;
  localProvider: FasterWhisperLocalProvider;
  gateway: SttGateway;
}

export function buildSttStack(
  slotsRepo: GroqSlotMetaRepo,
  tokenUsageRepo: TokenUsageRepo,
  settingsRepo: SettingsRepo,
  opts: BuildSttStackOptions = {},
): SttStack {
  const pool = new GroqKeyPool(slotsRepo, tokenUsageRepo);
  const groqProvider = new GroqProvider(pool, opts.groqOptions);
  const localProvider = new FasterWhisperLocalProvider(opts.localOptions);
  const gateway = new SttGateway(groqProvider, localProvider, pool, settingsRepo, {
    ...opts.gatewayOptions,
    broadcastBadge: opts.broadcastBadge ?? opts.gatewayOptions?.broadcastBadge,
  });
  return { pool, groqProvider, localProvider, gateway };
}

export { GroqKeyPool } from './groq-key-pool.js';
export { GroqProvider } from './groq-provider.js';
export { FasterWhisperLocalProvider } from './faster-whisper-local-provider.js';
export { SttGateway } from './stt-gateway.js';
export { validateGroqKey } from './validate-groq-key.js';
export * from './stt-types.js';
