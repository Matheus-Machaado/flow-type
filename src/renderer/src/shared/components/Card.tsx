import { cn } from '../lib/cn'

/**
 * Card — surface dark padrão. Usado pra slots Groq, items do histórico,
 * blocos de seção em Settings.
 */
export function Card({
  children,
  className,
  interactive
}: {
  children: React.ReactNode
  className?: string
  interactive?: boolean
}): JSX.Element {
  return (
    <div
      className={cn(
        'bg-bg-2 border border-border rounded-lg',
        interactive && 'hover:border-accent/30 transition-colors',
        className
      )}
    >
      {children}
    </div>
  )
}
