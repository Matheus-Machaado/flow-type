import { useEffect, useRef, useState } from 'react'

/**
 * Capturing state: 7-bar waveform reactive to mic input level.
 * If a `volumeRms` value flows in through props (set by WO-2 mic pipeline),
 * we render real-time. Otherwise we fall back to a synthetic animation so the
 * shape never goes flat — better DX during WO-1 isolated testing.
 *
 * Duration counter ticks once per 100ms.
 */
export function CapturingWaveform({
  volumeRms,
  startedAt
}: {
  volumeRms?: number
  startedAt: number
}): JSX.Element {
  const [bars, setBars] = useState<number[]>(() => new Array(7).fill(4))
  const [elapsed, setElapsed] = useState(0)
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(performance.now())

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startedAt))
    }, 100)
    return () => clearInterval(id)
  }, [startedAt])

  useEffect(() => {
    function tick(): void {
      const now = performance.now()
      if (now - lastTickRef.current >= 60) {
        lastTickRef.current = now
        const baseline = typeof volumeRms === 'number' ? Math.min(1, Math.max(0, volumeRms)) : 0
        setBars((prev) =>
          prev.map((_, i) => {
            // jitter centered around the rms baseline (or a soft synthetic sin).
            const synth = baseline > 0
              ? baseline
              : 0.25 + 0.25 * Math.sin(now / 220 + i * 0.7)
            const noise = Math.random() * 0.35
            const height = 4 + Math.floor((synth + noise) * 20) // 4..28
            return Math.min(28, Math.max(4, height))
          })
        )
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [volumeRms])

  const seconds = (elapsed / 1000).toFixed(1)

  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex items-end gap-[3px] h-6">
        {bars.map((h, i) => (
          <span
            key={i}
            aria-hidden
            className="w-[3px] rounded-sm bg-accent shadow-glow"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
      <span className="text-xs font-mono text-text-secondary">{seconds}s</span>
    </div>
  )
}
