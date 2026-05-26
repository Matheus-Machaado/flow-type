import { cn } from '../lib/cn'

/**
 * Toggle — switch acessível com aria-checked. Cyan quando on, surface quando off.
 */
export function Toggle({
  on,
  onChange,
  disabled,
  ariaLabel,
  className
}: {
  on: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0',
        on ? 'bg-accent' : 'bg-surface-hi border border-border',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full transition-transform',
          on ? 'translate-x-5 bg-bg-0' : 'translate-x-0.5 bg-text-muted'
        )}
      />
    </button>
  )
}
