import { forwardRef } from 'react'
import { cn } from '../lib/cn'

type Variant = 'primary' | 'ghost' | 'danger' | 'accent-soft'
type Size = 'sm' | 'md'

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-accent text-text-on-accent hover:bg-accent-2 active:bg-accent-deep border border-accent/0',
  'accent-soft':
    'bg-accent/10 hover:bg-accent/15 border border-accent/30 text-accent',
  ghost:
    'bg-transparent hover:bg-surface text-text-secondary hover:text-text-primary border border-transparent',
  danger:
    'bg-transparent hover:bg-danger/10 text-text-muted hover:text-danger border border-transparent'
}

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[11px]',
  md: 'h-9 px-3.5 text-xs'
}

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

/**
 * Button — variantes cyan / soft / ghost / danger. Inclui focus-visible ring
 * cyan e disabled state suave. Use `Button.tsx` em vez de `<button>` puro
 * quando precisar de feedback hover/active consistentes.
 */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'ghost', size = 'sm', className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className
      )}
    >
      {children}
    </button>
  )
})
