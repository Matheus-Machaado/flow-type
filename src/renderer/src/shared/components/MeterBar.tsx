import { cn } from '../lib/cn'

/**
 * MeterBar — barrinha de usage 4px (usage Groq, volume mic). Cor preenche
 * gradiente accent → accent-2 quando ok; warning quando >75%; danger quando 100%.
 */
export function MeterBar({
  value,
  max = 100,
  className,
  tone
}: {
  value: number
  max?: number
  className?: string
  tone?: 'auto' | 'accent' | 'warning' | 'danger'
}): JSX.Element {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  const resolved =
    tone && tone !== 'auto' ? tone : pct >= 100 ? 'danger' : pct >= 75 ? 'warning' : 'accent'
  const fill =
    resolved === 'danger'
      ? 'bg-gradient-to-r from-danger to-danger'
      : resolved === 'warning'
        ? 'bg-gradient-to-r from-warning to-accent'
        : 'bg-gradient-to-r from-accent to-accent-2'
  return (
    <div className={cn('w-full h-1 bg-bg-0 rounded-full overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
