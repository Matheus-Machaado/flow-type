/**
 * Method policy — decide clipboard vs typing por exeName + settings.
 *
 * Cobre e3-app-whitelist-blacklist.
 *
 * Fontes:
 *  - `injection_method_default` ('clipboard' | 'typing') — default global.
 *  - `injection_method_overrides` ({ exeName: method }) — per-app overrides.
 *  - `injection_blacklist` (string[]) — bloqueia paste, throw InjectionBlockedByPolicy.
 *
 * Compatibilidade com schema legado (db-types):
 *  - Se `injection_*` ausentes, lê `app_blacklist` e `app_force_typing`
 *    (chaves originais do SETTINGS_DEFAULTS WO-6) como fallback.
 *
 * Defaults sensatos pré-configurados (DEFAULT_OVERRIDES):
 *  - keepass.exe, 1password.exe → typing (apps de senha tipicamente bloqueiam paste).
 */

import type { InjectionMethod, MethodPolicySettings } from './injection-types.js';
import { InjectionBlockedByPolicy } from './injection-types.js';

export const DEFAULT_OVERRIDES: Record<string, InjectionMethod> = {
  'keepass.exe': 'typing',
  '1password.exe': 'typing',
};

export interface MethodPolicyDecisionInput {
  /** Pode ser null em macOS/Linux ou quando detector falha. */
  exeName: string | null;
  settings: MethodPolicySettings & {
    // Compat: chaves originais do schema WO-6.
    app_blacklist?: string[];
    app_force_typing?: string[];
  };
}

/**
 * Decide o método. Throw InjectionBlockedByPolicy se exeName está em blacklist.
 *
 * Em ausência de exeName (null/vazio) → assume default (não há policy aplicável).
 */
export function decidePasteMethod(input: MethodPolicyDecisionInput): InjectionMethod {
  const exe = (input.exeName ?? '').toLowerCase().trim();
  const blacklist = [
    ...(input.settings.injection_blacklist ?? []),
    ...(input.settings.app_blacklist ?? []),
  ].map((s) => s.toLowerCase().trim());

  if (exe && blacklist.includes(exe)) {
    throw new InjectionBlockedByPolicy(exe);
  }

  const overrides = {
    ...DEFAULT_OVERRIDES,
    ...(legacyForceTypingToOverrides(input.settings.app_force_typing) ?? {}),
    ...(input.settings.injection_method_overrides ?? {}),
  } as Record<string, InjectionMethod>;

  if (exe && overrides[exe]) return overrides[exe];

  return input.settings.injection_method_default ?? 'clipboard';
}

/**
 * Helper: mapeia chave legada `app_force_typing: string[]` → overrides
 * `{ exe: 'typing' }` pra compat com schema WO-6.
 */
function legacyForceTypingToOverrides(
  list: string[] | undefined,
): Record<string, InjectionMethod> | null {
  if (!list || list.length === 0) return null;
  const out: Record<string, InjectionMethod> = {};
  for (const exe of list) {
    out[exe.toLowerCase().trim()] = 'typing';
  }
  return out;
}
