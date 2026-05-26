import { cn } from '../../../shared/lib/cn'

/**
 * DotNav — 4 dots horizontais. Os dots ATÉ o currentStep (inclusive)
 * ficam preenchidos cyan; os à frente ficam mutados. Não-interativo
 * (avanço só via botões dos steps, evita pular validações).
 */
export function DotNav({
  current,
  total = 4
}: {
  current: number
  total?: number
}): JSX.Element {
  return (
    <div
      className="flex items-center gap-2"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      aria-label={`Passo ${current + 1} de ${total}`}
    >
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current
        const active = i === current
        return (
          <span
            key={i}
            aria-hidden
            className={cn(
              'rounded-full transition-all',
              active
                ? 'w-6 h-1.5 bg-accent shadow-[0_0_8px_rgba(95,230,255,0.55)]'
                : done
                  ? 'w-1.5 h-1.5 bg-accent/80'
                  : 'w-1.5 h-1.5 bg-text-faint/40'
            )}
          />
        )
      })}
    </div>
  )
}
