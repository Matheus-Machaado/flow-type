/**
 * Boot helper: monta ActiveWindowDetector + KeystrokeSender + TextInjector
 * com dependências injetadas. Chamado em src/main/index.ts.
 */

import type { SettingsRepo } from '../repos/settings-repo.js';
import { ActiveWindowDetector, type ActiveWindowDetectorOptions } from './active-window-detector.js';
import { KeystrokeSender, type KeystrokeSenderOptions } from './keystroke-sender.js';
import { TextInjector, type TextInjectorOptions } from './text-injector.js';

export interface BuildInjectionStackOptions {
  detectorOptions?: ActiveWindowDetectorOptions;
  keystrokeOptions?: KeystrokeSenderOptions;
  injectorOptions?: Omit<TextInjectorOptions, 'keystrokeSender'>;
}

export interface InjectionStack {
  detector: ActiveWindowDetector;
  keystrokeSender: KeystrokeSender;
  injector: TextInjector;
}

export function buildInjectionStack(
  settings: SettingsRepo,
  opts: BuildInjectionStackOptions = {},
): InjectionStack {
  const detector = new ActiveWindowDetector(opts.detectorOptions);
  const keystrokeSender = new KeystrokeSender(opts.keystrokeOptions);
  const injector = new TextInjector(detector, settings, {
    ...opts.injectorOptions,
    keystrokeSender,
  });
  return { detector, keystrokeSender, injector };
}

export { ActiveWindowDetector, parseWindowInfo } from './active-window-detector.js';
export { KeystrokeSender } from './keystroke-sender.js';
export { TextInjector } from './text-injector.js';
export { refocusWindow } from './refocus-window.js';
export {
  snapshotClipboard,
  restoreClipboard,
  __setDefaultClipboardForTest,
} from './clipboard-state.js';
export { decidePasteMethod, DEFAULT_OVERRIDES } from './method-policy.js';
export { applyPunctuationHeuristic } from './punctuation-heuristic.js';
export * from './injection-types.js';
