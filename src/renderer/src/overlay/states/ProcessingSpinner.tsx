/**
 * Processing state: rotating 14px ring + sub-label.
 * The label cycles based on what WO-2 reports via the optional `label` meta
 * (e.g. "Groq · slot #1", "transcrevendo…", "colando…").
 */
export function ProcessingSpinner({ label }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <span
        aria-hidden
        className="inline-block w-3.5 h-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin"
      />
      <span className="text-sm text-text-primary truncate max-w-[140px]">
        {label ?? 'transcrevendo…'}
      </span>
    </div>
  )
}
