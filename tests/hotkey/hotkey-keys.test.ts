import { describe, it, expect } from 'vitest'
import {
  CODE_TO_UIOHOOK_NAME,
  DEFAULT_BINDING_CODE,
  codeToElectronAccelerator,
  displayLabel,
  eventToCode,
  isSupportedCode,
  normalizeBinding
} from '@shared/hotkey-keys'

/**
 * Valid `UiohookKey` enum names + a few critical numeric values, mirrored
 * from uiohook-napi's dist/index.d.ts. We assert against this instead of
 * importing the package because `require('uiohook-napi')` loads the native
 * addon at import time, which is ABI-locked to the install-time runtime.
 */
const UIOHOOK_NAMES = new Set<string>([
  'Backspace', 'Tab', 'Enter', 'CapsLock', 'Escape', 'Space', 'PageUp',
  'PageDown', 'End', 'Home', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
  'Insert', 'Delete', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
  'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6',
  'Numpad7', 'Numpad8', 'Numpad9', 'NumpadMultiply', 'NumpadAdd',
  'NumpadSubtract', 'NumpadDecimal', 'NumpadDivide', 'NumpadEnter',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22', 'F23',
  'F24', 'Semicolon', 'Equal', 'Comma', 'Minus', 'Period', 'Slash',
  'Backquote', 'BracketLeft', 'Backslash', 'BracketRight', 'Quote', 'Ctrl',
  'CtrlRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight', 'Meta', 'MetaRight',
  'NumLock', 'ScrollLock', 'PrintScreen'
])
// Spot values that pin the netbook fix.
const UIOHOOK_VALUE: Record<string, number> = { AltRight: 0x0e38, CtrlRight: 0x0e1d }

/** Minimal DOM KeyboardEvent stub for eventToCode (runs under node env). */
function ke(opts: {
  key?: string
  code?: string
  altGraph?: boolean
}): KeyboardEvent {
  return {
    key: opts.key ?? '',
    code: opts.code ?? '',
    getModifierState: (m: string) => m === 'AltGraph' && Boolean(opts.altGraph)
  } as unknown as KeyboardEvent
}

describe('hotkey-keys — canonical key model', () => {
  it('every mapped code points at a real uIOhook enum name', () => {
    // This is the contract that was broken: the binding the user picks must
    // map to an actual keycode the listener can match against.
    for (const [code, name] of Object.entries(CODE_TO_UIOHOOK_NAME)) {
      expect(UIOHOOK_NAMES.has(name), `${code} → ${name}`).toBe(true)
    }
  })

  it('AltGr resolves end-to-end (the netbook case)', () => {
    // AltGr fires as key='AltGraph' / code='AltRight' in Chromium.
    expect(eventToCode(ke({ key: 'AltGraph', code: 'AltRight' }))).toBe('AltRight')
    // ...and 'AltRight' maps to the uIOhook right-alt keycode (3640).
    expect(UIOHOOK_VALUE[CODE_TO_UIOHOOK_NAME['AltRight']]).toBe(3640)
    expect(UIOHOOK_VALUE[CODE_TO_UIOHOOK_NAME['ControlRight']]).toBe(3613)
    // The synthetic LeftCtrl Windows injects alongside AltGr is dropped.
    expect(eventToCode(ke({ key: 'Control', code: 'ControlLeft', altGraph: true }))).toBeNull()
  })

  it('legacy stored values still resolve', () => {
    expect(normalizeBinding('Right Ctrl')).toBe('ControlRight')
    expect(normalizeBinding('Left Ctrl')).toBe('ControlLeft')
    expect(normalizeBinding('F12')).toBe('F12')
    // Junk combo produced by the old capture for AltGr.
    expect(normalizeBinding('Ctrl+Alt+AltGraph')).toBe('AltRight')
    // Unknown / empty falls back to a usable default, never dies.
    expect(normalizeBinding('')).toBe(DEFAULT_BINDING_CODE)
    expect(normalizeBinding(undefined)).toBe(DEFAULT_BINDING_CODE)
  })

  it('arbitrary keys are supported, not just a whitelist', () => {
    expect(isSupportedCode('AltRight')).toBe(true)
    expect(isSupportedCode('ShiftRight')).toBe(true)
    expect(isSupportedCode('F7')).toBe(true)
    expect(isSupportedCode('KeyK')).toBe(true)
    expect(isSupportedCode('Digit5')).toBe(true)
    expect(eventToCode(ke({ key: 'k', code: 'KeyK' }))).toBe('KeyK')
    expect(eventToCode(ke({ key: 'F7', code: 'F7' }))).toBe('F7')
  })

  it('friendly labels read well in pt-BR', () => {
    expect(displayLabel('AltRight')).toBe('AltGr')
    expect(displayLabel('Right Ctrl')).toBe('Ctrl direito')
    expect(displayLabel('ControlRight')).toBe('Ctrl direito')
    expect(displayLabel('KeyA')).toBe('A')
    expect(displayLabel('F12')).toBe('F12')
    expect(displayLabel('Digit5')).toBe('5')
  })

  it('electron fallback collapses bare modifiers, passes through real keys', () => {
    expect(codeToElectronAccelerator('AltRight')).toBe('CommandOrControl+Alt+Space')
    expect(codeToElectronAccelerator('Right Ctrl')).toBe('CommandOrControl+Alt+Space')
    expect(codeToElectronAccelerator('F8')).toBe('F8')
    expect(codeToElectronAccelerator('KeyA')).toBe('A')
  })
})
