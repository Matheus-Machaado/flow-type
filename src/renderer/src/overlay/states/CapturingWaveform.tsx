import { useEffect, useRef, useState } from 'react'

/**
 * Capturing state: 7-bar waveform driven by the REAL mic RMS.
 *
 * NÃO há animação cenográfica: quando o microfone está mudo, desconectado,
 * ou sem permissão, `volumeRms` fica em 0 e as barras achatam no piso
 * (3 px). Isso é intencional — o usuário precisa identificar imediatamente
 * que algo está errado com o áudio. Visual "decorativo" que parece áudio
 * sem ser áudio engana o user; preferimos a barra morta + cor de silêncio.
 *
 * Duration counter ticks once per 100ms.
 */
const BAR_COUNT = 7
const BAR_MIN_PX = 3
const BAR_MAX_PX = 24
// Pesos por barra criam um pico central (look de waveform real),
// sem inventar dados — só distribui a energia medida.
const BAR_WEIGHTS = [0.55, 0.78, 0.92, 1, 0.92, 0.78, 0.55]

export function CapturingWaveform({
  volumeRms,
  startedAt
}: {
  volumeRms?: number
  startedAt: number
}): JSX.Element {
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(BAR_MIN_PX))
  const [elapsed, setElapsed] = useState(0)
  const rafRef = useRef<number | null>(null)

  // Counter (1 update / 100ms)
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startedAt))
    }, 100)
    return () => clearInterval(id)
  }, [startedAt])

  // Bar heights follow live RMS. Sem random, sem sin. RMS=0 → todas no piso.
  useEffect(() => {
    const tick = (): void => {
      const v = typeof volumeRms === 'number' ? Math.min(1, Math.max(0, volumeRms)) : 0
      setBars(
        BAR_WEIGHTS.map((w) => {
          const h = BAR_MIN_PX + Math.round(v * w * (BAR_MAX_PX - BAR_MIN_PX))
          return Math.max(BAR_MIN_PX, Math.min(BAR_MAX_PX, h))
        })
      )
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [volumeRms])

  const seconds = (elapsed / 1000).toFixed(1)
  // Threshold pequeno pra não pintar de cinza por ruído de fundo natural.
  const isSilent = (volumeRms ?? 0) < 0.02

  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div
        className="flex items-end gap-[3px]"
        style={{ height: BAR_MAX_PX }}
        aria-label={isSilent ? 'Microfone sem sinal' : 'Capturando voz'}
      >
        {bars.map((h, i) => (
          <span
            key={i}
            aria-hidden
            className={
              isSilent
                ? 'w-[3px] rounded-sm bg-text-faint'
                : 'w-[3px] rounded-sm bg-accent shadow-glow'
            }
            style={{ height: `${h}px`, transition: 'height 60ms linear' }}
          />
        ))}
      </div>
      <span className="text-xs font-mono text-text-secondary">{seconds}s</span>
    </div>
  )
}
