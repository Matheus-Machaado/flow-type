import { useEffect, useRef, useState } from 'react'
import { eventToCode, displayLabel } from '@shared/hotkey-keys'
import { Button } from '../../shared/components/Button'

/**
 * HotkeyCapture — captura UMA tecla física (push-to-talk) via keydown global
 * enquanto em foco. Grava o `KeyboardEvent.code` canônico (independente de
 * layout/PC) e exibe um label amigável.
 *
 * Estados: idle (mostra tecla atual) · capturing (pulsa cyan, "pressione…")
 * · detected (mostra tecla nova + salvar/cancelar). Esc cancela.
 *
 * Aceita qualquer tecla suportada: AltGr, Ctrl/Shift/Alt direito ou esquerdo,
 * F1–F24, letras, etc. Teclas não suportadas e o Ctrl fantasma do AltGr são
 * ignorados (segue aguardando). NÃO valida conflitos com o sistema — isso
 * fica com o main process via `hotkey:set-binding`.
 */
export function HotkeyCapture({
  current,
  onSave
}: {
  current: string
  onSave: (code: string) => Promise<void> | void
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
      const code = eventToCode(e)
      if (!code) return // phantom / tecla não suportada → segue aguardando
      setDetected(code)
      setMode('detected')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode])

  async function confirm(code: string): Promise<void> {
    await onSave(code)
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
        {mode === 'capturing'
          ? 'pressione…'
          : mode === 'detected'
            ? displayLabel(detected)
            : displayLabel(current)}
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
