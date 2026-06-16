/**
 * Canonical hotkey key model — shared by the renderer (capture + display)
 * and the main process (uIOhook listener / Electron fallback).
 *
 * The push-to-talk binding is ONE physical key. We store it as the
 * KeyboardEvent.code value ('ControlRight', 'AltRight', 'F12', 'KeyA', …),
 * which is layout-independent and maps deterministically to a uIOhook
 * keycode on ANY keyboard/PC. That is what makes "swap the key and it just
 * works" actually hold: AltGr, right-shift, an F-key or a plain letter all
 * resolve through the same table instead of a 5-entry whitelist of human
 * labels (the old design silently dropped everything else — including
 * AltGr on machines without a right Ctrl).
 */

/** Canonical binding token = a KeyboardEvent.code we know how to map. */
export const DEFAULT_BINDING_CODE = 'ControlRight'

/**
 * code → uIOhook `UiohookKey` enum NAME. The numeric value is resolved at
 * runtime from the loaded `uiohook-napi` module, keeping that package the
 * single source of truth for the actual keycodes.
 */
export const CODE_TO_UIOHOOK_NAME: Record<string, string> = (() => {
  const m: Record<string, string> = {
    ControlLeft: 'Ctrl',
    ControlRight: 'CtrlRight',
    AltLeft: 'Alt',
    AltRight: 'AltRight',
    ShiftLeft: 'Shift',
    ShiftRight: 'ShiftRight',
    MetaLeft: 'Meta',
    MetaRight: 'MetaRight',
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    CapsLock: 'CapsLock',
    Escape: 'Escape',
    Insert: 'Insert',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    PrintScreen: 'PrintScreen',
    ScrollLock: 'ScrollLock',
    NumLock: 'NumLock',
    Semicolon: 'Semicolon',
    Equal: 'Equal',
    Comma: 'Comma',
    Minus: 'Minus',
    Period: 'Period',
    Slash: 'Slash',
    Backquote: 'Backquote',
    BracketLeft: 'BracketLeft',
    Backslash: 'Backslash',
    BracketRight: 'BracketRight',
    Quote: 'Quote',
    NumpadAdd: 'NumpadAdd',
    NumpadSubtract: 'NumpadSubtract',
    NumpadMultiply: 'NumpadMultiply',
    NumpadDivide: 'NumpadDivide',
    NumpadDecimal: 'NumpadDecimal',
    NumpadEnter: 'NumpadEnter'
  }
  for (let i = 0; i < 26; i++) {
    const L = String.fromCharCode(65 + i)
    m[`Key${L}`] = L
  }
  for (let d = 0; d <= 9; d++) {
    m[`Digit${d}`] = String(d)
    m[`Numpad${d}`] = `Numpad${d}`
  }
  for (let f = 1; f <= 24; f++) {
    m[`F${f}`] = `F${f}`
  }
  return m
})()

/** Friendly pt-BR labels for the codes that read poorly raw. */
const CODE_TO_LABEL: Record<string, string> = {
  ControlRight: 'Ctrl direito',
  ControlLeft: 'Ctrl esquerdo',
  AltRight: 'AltGr',
  AltLeft: 'Alt',
  ShiftRight: 'Shift direito',
  ShiftLeft: 'Shift esquerdo',
  MetaRight: 'Win direito',
  MetaLeft: 'Win',
  Space: 'Espaço',
  Escape: 'Esc',
  CapsLock: 'Caps Lock',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PrintScreen: 'PrtSc',
  ScrollLock: 'Scroll Lock',
  NumLock: 'Num Lock'
}

const PUNCT_LABEL: Record<string, string> = {
  Semicolon: ';',
  Equal: '=',
  Comma: ',',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  Backslash: '\\',
  BracketRight: ']',
  Quote: "'"
}

/** Legacy stored labels (pre-canonical-code) → canonical code. */
const LEGACY_LABEL_TO_CODE: Record<string, string> = {
  'Right Ctrl': 'ControlRight',
  'Left Ctrl': 'ControlLeft',
  Ctrl: 'ControlLeft',
  Control: 'ControlLeft',
  'Right Shift': 'ShiftRight',
  'Left Shift': 'ShiftLeft',
  Shift: 'ShiftLeft',
  'Right Alt': 'AltRight',
  AltGr: 'AltRight',
  AltGraph: 'AltRight',
  Alt: 'AltLeft',
  Meta: 'MetaLeft',
  Win: 'MetaLeft',
  Space: 'Space'
}

export function isSupportedCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CODE_TO_UIOHOOK_NAME, code)
}

/**
 * Resolve a stored binding (canonical code, legacy human label, or even an
 * old broken combo string from the previous capture) to a canonical code.
 * Always returns something resolvable so the hotkey never silently dies.
 */
export function normalizeBinding(stored: string | null | undefined): string {
  if (!stored) return DEFAULT_BINDING_CODE
  const raw = String(stored).trim()
  if (isSupportedCode(raw)) return raw
  if (LEGACY_LABEL_TO_CODE[raw]) return LEGACY_LABEL_TO_CODE[raw]
  // Old capture produced combo strings like 'Ctrl+Alt+AltGraph'.
  if (/altgr(aph)?/i.test(raw)) return 'AltRight'
  const last = raw.split('+').pop()?.trim() ?? ''
  if (isSupportedCode(last)) return last
  if (LEGACY_LABEL_TO_CODE[last]) return LEGACY_LABEL_TO_CODE[last]
  if (/^[A-Za-z]$/.test(last)) return `Key${last.toUpperCase()}`
  if (/^[0-9]$/.test(last)) return `Digit${last}`
  if (/^F\d{1,2}$/.test(last)) return last
  return DEFAULT_BINDING_CODE
}

/** Human label for whatever is stored (handles legacy values too). */
export function displayLabel(stored: string | null | undefined): string {
  const code = normalizeBinding(stored)
  if (CODE_TO_LABEL[code]) return CODE_TO_LABEL[code]
  if (PUNCT_LABEL[code]) return PUNCT_LABEL[code]
  const key = /^Key([A-Z])$/.exec(code)
  if (key) return key[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]
  if (/^F\d{1,2}$/.test(code)) return code
  const numpad = /^Numpad(.+)$/.exec(code)
  if (numpad) return `Num ${numpad[1]}`
  return code
}

/**
 * Canonical code for a captured DOM KeyboardEvent, or null if it's a key we
 * don't support / a phantom event we must ignore.
 *
 * AltGr on Windows fires as key='AltGraph' code='AltRight' AND injects a
 * synthetic ControlLeft. We canonicalize AltGr to 'AltRight' and drop the
 * phantom Ctrl so the user gets the key they actually pressed.
 */
export function eventToCode(e: KeyboardEvent): string | null {
  if (e.key === 'AltGraph') return 'AltRight'
  if (
    e.code === 'ControlLeft' &&
    typeof e.getModifierState === 'function' &&
    e.getModifierState('AltGraph')
  ) {
    return null
  }
  if (e.code && isSupportedCode(e.code)) return e.code
  return null
}

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight'
])

/**
 * Best-effort Electron globalShortcut accelerator for the degraded fallback
 * path (only used when the uIOhook native binary fails to load). Bare
 * modifiers can't be registered as global accelerators, so they collapse to
 * a synthetic combo that at least keeps the app usable.
 */
export function codeToElectronAccelerator(stored: string): string {
  const code = normalizeBinding(stored)
  if (MODIFIER_CODES.has(code)) return 'CommandOrControl+Alt+Space'
  if (/^F\d{1,2}$/.test(code)) return code
  const key = /^Key([A-Z])$/.exec(code)
  if (key) return key[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]
  if (code === 'Space') return 'Space'
  return 'CommandOrControl+Alt+Space'
}
