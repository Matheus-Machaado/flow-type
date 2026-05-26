import { useEffect, useRef, useState } from 'react'
import { cn } from '../../../shared/lib/cn'

/**
 * VolumeMeter — barras horizontais animadas (24 segments) que reagem
 * ao volume do `stream` via Web Audio API AnalyserNode.
 *
 * - Quando `stream` é null/undefined: mostra barras inertes (estado idle).
 * - Quando ativo: lê `getByteFrequencyData` em rAF e mapeia média → nº de
 *   barras acesas.
 * - Cleanup robusto: desconecta source + fecha AudioContext quando
 *   stream muda OU componente desmonta.
 *
 * Inspirado direto do MicrofoneSection (consistência), só puxado pra
 * componente isolado pra ser reutilizado no StepMicrophone.
 */
export function VolumeMeter({
  stream,
  segments = 24,
  className
}: {
  stream: MediaStream | null
  segments?: number
  className?: string
}): JSX.Element {
  const [level, setLevel] = useState(0)
  const rafRef = useRef<number | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null)

  useEffect(() => {
    if (!stream || typeof window === 'undefined') {
      setLevel(0)
      return
    }
    let cancelled = false
    try {
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      srcRef.current = src
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      src.connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)

      const tick = (): void => {
        if (cancelled) return
        analyser.getByteFrequencyData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i]
        const avg = sum / buf.length / 255
        setLevel(avg)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      // ignore; meter just stays at 0
    }

    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      try {
        srcRef.current?.disconnect()
      } catch {
        // ignore
      }
      try {
        void ctxRef.current?.close()
      } catch {
        // ignore
      }
      srcRef.current = null
      ctxRef.current = null
      setLevel(0)
    }
  }, [stream])

  return (
    <div
      className={cn('flex items-end gap-[3px] h-8 px-2', className)}
      aria-label="Volume meter"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      {Array.from({ length: segments }).map((_, i) => {
        const active = level * segments > i
        return (
          <span
            key={i}
            aria-hidden
            className={cn(
              'w-1.5 rounded-sm transition-all',
              active ? 'bg-accent shadow-glow' : 'bg-bg-2 border border-border'
            )}
            style={{ height: `${Math.max(6, (i + 1) * 1.2)}px` }}
          />
        )
      })}
    </div>
  )
}
