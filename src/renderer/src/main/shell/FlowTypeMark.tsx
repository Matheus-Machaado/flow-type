/**
 * FlowTypeMark — logo mark (square + waveform glyph) usado no header.
 * Sem texto — pra texto use "Flow Type" como label adjacente.
 */
export function FlowTypeMark({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <span
      aria-hidden
      className="rounded bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center text-bg-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={Math.round(size * 0.55)}
        height={Math.round(size * 0.55)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12h4l3-9 4 18 3-9h4" />
      </svg>
    </span>
  )
}
