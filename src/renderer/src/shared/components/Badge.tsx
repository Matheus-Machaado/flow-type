import { cn } from '../lib/cn'

/**
 * Badge — status pill com dot opcional. Variantes pareadas com semantic colors
 * do design-spec (success/warning/danger/info/accent/muted).
 */
export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'muted'

const TONE_CLASS: Record<BadgeTone, { wrap: string; dot: string }> = {
  success: {
    wrap: 'bg-success/10 text-success border-success/30',
    dot: 'bg-success shadow-[0_0_6px_rgba(52,211,153,0.55)]'
  },
  warning: {
    wrap: 'bg-warning/10 text-warning border-warning/30',
    dot: 'bg-warning shadow-[0_0_6px_rgba(251,191,36,0.55)]'
  },
  danger: {
    wrap: 'bg-danger/10 text-danger border-danger/30',
    dot: 'bg-danger shadow-[0_0_6px_rgba(248,113,113,0.55)]'
  },
  info: {
    wrap: 'bg-info/10 text-info border-info/30',
    dot: 'bg-info'
  },
  accent: {
    wrap: 'bg-accent/10 text-accent border-accent/30',
    dot: 'bg-accent shadow-glow'
  },
  muted: {
    wrap: 'bg-bg-0 text-text-faint border-border',
    dot: 'bg-text-faint'
  }
}

export function Badge({
  children,
  tone = 'muted',
  dot = false,
  className
}: {
  children: React.ReactNode
  tone?: BadgeTone
  dot?: boolean
  className?: string
}): JSX.Element {
  const t = TONE_CLASS[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium border rounded-full',
        t.wrap,
        className
      )}
    >
      {dot ? <span aria-hidden className={cn('w-1.5 h-1.5 rounded-full', t.dot)} /> : null}
      {children}
    </span>
  )
}
