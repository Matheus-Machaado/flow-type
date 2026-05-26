/**
 * Idle state: 8px dot, breathing animation, muted color.
 * Default opacity 0.45 (hot-corner reveal raises to 1.0).
 */
export function IdleDot(): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="inline-block w-2 h-2 rounded-full bg-text-muted animate-idle-breathe"
      />
      <span className="text-xs text-text-faint font-medium tracking-wide">flowtype</span>
    </div>
  )
}
