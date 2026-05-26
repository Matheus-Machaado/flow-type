import { forwardRef } from 'react'
import { cn } from '../lib/cn'

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  invalid?: boolean
}

/**
 * Input — base controlado pra forms internos. Aplica focus cyan,
 * bg-bg-2, border sutil, dark theme. Suporta label/hint.
 */
export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, invalid, className, id, ...rest },
  ref
) {
  const inputId = id ?? `i-${Math.random().toString(36).slice(2, 9)}`
  return (
    <label htmlFor={inputId} className="block">
      {label ? (
        <span className="block text-[10px] uppercase tracking-wider text-text-faint mb-1 font-mono">
          {label}
        </span>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        {...rest}
        className={cn(
          'w-full h-9 px-3 rounded-lg bg-bg-2 border text-sm text-text-primary',
          'placeholder:text-text-faint',
          'focus:outline-none focus:border-accent/60 focus:bg-surface',
          'transition-colors',
          invalid ? 'border-danger/60' : 'border-border',
          className
        )}
      />
      {hint ? <span className="block text-[10px] text-text-muted mt-1">{hint}</span> : null}
    </label>
  )
})
