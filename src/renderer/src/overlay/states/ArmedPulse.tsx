/**
 * Armed state: 12px accent dot, fast pulse, label "ouvindo…".
 * Aria-live polite so screen readers announce the transition.
 */
export function ArmedPulse(): JSX.Element {
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <span
        aria-hidden
        className="inline-block w-3 h-3 rounded-full bg-accent shadow-glow animate-armed-pulse"
      />
      <span className="text-sm font-medium text-text-primary">ouvindo…</span>
    </div>
  )
}
