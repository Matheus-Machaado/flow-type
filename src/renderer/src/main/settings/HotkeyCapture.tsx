import { useEffect, useRef, useState } from 'react'
import { Button } from '../../shared/components/Button'

/**
 * HotkeyCapture — captura combo viva via keydown global enquanto em foco.
 *
 * Estados: idle (mostra valor atual) · capturing (pulsa cyan) · detected
 * (mostra nova combo + salvar/cancelar). Esc cancela, Enter confirma.
 *
 * NÃO valida conflitos com hotkeys do sistema — isso fica com o main process
 * via `hotkey:set-binding` (que rebinda + reporta erro se conflito).
 */
export function HotkeyCapture({
  current,
  onSave
}: {
  current: string
  onSave: (combo: string) => Promise<void> | void
}): JSX.Element {
  const [mode, setMode] = useState<'idle' | 'capturing' | 'detected'>('idle')
  const [detected, setDetected] = useState<string>('')
  const captureRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode !== 'capturing') return
    function onKey(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setMode('idle')
        return
      }
      if (e.key === 'Enter' && detected) {
        void confirm(detected)
        return
      }
      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')
      if (e.metaKey) parts.push('Meta')
      const key = normalizeKey(e.key, e.code)
      if (key && !parts.includes(key)) parts.push(key)
      if (parts.length > 0) setDetected(parts.join('+'))
      if (parts.length > 0 && !isModifierOnly(key)) {
        setMode('detected')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode, detected])

  async function confirm(combo: string): Promise<void> {
    await onSave(combo)
    setMode('idle')
    setDetected('')
  }

  return (
    <div className="flex items-center gap-2" ref={captureRef}>
      <span
        className={
          mode === 'capturing'
            ? 'inline-flex items-center px-2.5 py-1 rounded-md bg-accent/10 text-accent border border-accent/40 font-mono text-xs animate-pulse'
            : mode === 'detected'
              ? 'inline-flex items-center px-2.5 py-1 rounded-md bg-success/10 text-success border border-success/40 font-mono text-xs'
              : 'inline-flex items-center px-2.5 py-1 rounded-md bg-surface text-accent border border-border font-mono text-xs'
        }
      >
        {mode === 'capturing' ? 'pressione…' : mode === 'detected' ? detected : current}
      </span>

      {mode === 'idle' ? (
        <Button variant="ghost" onClick={() => setMode('capturing')}>
          mudar
        </Button>
      ) : mode === 'capturing' ? (
        <Button variant="ghost" onClick={() => setMode('idle')}>
          cancelar (esc)
        </Button>
      ) : (
        <>
          <Button variant="primary" onClick={() => void confirm(detected)}>
            salvar
          </Button>
          <Button variant="ghost" onClick={() => setMode('idle')}>
            cancelar
          </Button>
        </>
      )}
    </div>
  )
}

function normalizeKey(key: string, code: string): string {
  if (key === 'Control' || code === 'ControlRight') return code === 'ControlRight' ? 'Right Ctrl' : 'Ctrl'
  if (key === 'Shift') return 'Shift'
  if (key === 'Alt') return 'Alt'
  if (key === 'Meta') return 'Meta'
  if (key === ' ') return 'Space'
  if (key.startsWith('F') && /^F\d+$/.test(key)) return key
  if (key.length === 1) return key.toUpperCase()
  return key
}

function isModifierOnly(key: string): boolean {
  return ['Ctrl', 'Shift', 'Alt', 'Meta', 'Right Ctrl'].includes(key)
}
