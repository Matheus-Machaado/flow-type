/**
 * SVG inline minimal illustrations usadas pelos passos do wizard.
 *
 * Tudo embutido pra evitar request HTTP extra e CSP de img. Cyan tone
 * casa com brand. Tamanho default ~120-160px; rotação leve via classe
 * `motion-safe:animate-*` quando aplicável.
 */

export function WelcomeWaveIllustration({ size = 160 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={Math.round(size * 0.66)}
      viewBox="0 0 240 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="text-accent"
    >
      <defs>
        <linearGradient id="wave-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5FE6FF" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#5FE6FF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#B8FFEE" stopOpacity="0.15" />
        </linearGradient>
        <radialGradient id="wave-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#5FE6FF" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#5FE6FF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Soft halo */}
      <ellipse cx="120" cy="80" rx="115" ry="60" fill="url(#wave-halo)" />

      {/* Outer ripple rings */}
      <circle cx="120" cy="80" r="56" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
      <circle cx="120" cy="80" r="40" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />

      {/* Center waveform (5 bars) */}
      <g transform="translate(120 80)">
        <rect x="-22" y="-10" width="4" height="20" rx="2" fill="currentColor" opacity="0.55" />
        <rect x="-12" y="-20" width="4" height="40" rx="2" fill="currentColor" opacity="0.85" />
        <rect x="-2" y="-26" width="4" height="52" rx="2" fill="currentColor" />
        <rect x="8" y="-18" width="4" height="36" rx="2" fill="currentColor" opacity="0.85" />
        <rect x="18" y="-8" width="4" height="16" rx="2" fill="currentColor" opacity="0.55" />
      </g>

      {/* Hair-thin flow lines */}
      <path
        d="M 8 110 Q 60 70 120 110 T 232 110"
        stroke="url(#wave-grad)"
        strokeWidth="1.4"
        fill="none"
      />
      <path
        d="M 8 130 Q 60 100 120 130 T 232 130"
        stroke="url(#wave-grad)"
        strokeWidth="1"
        fill="none"
        opacity="0.6"
      />
    </svg>
  )
}

export function MicIllustration({ size = 100 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden
      className="text-accent"
    >
      <defs>
        <radialGradient id="mic-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#5FE6FF" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#5FE6FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="55" fill="url(#mic-halo)" />
      <circle cx="60" cy="60" r="44" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      {/* Mic body */}
      <rect
        x="48"
        y="30"
        width="24"
        height="40"
        rx="12"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M 38 58 a 22 22 0 0 0 44 0"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <line x1="60" y1="80" x2="60" y2="92" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="48" y1="92" x2="72" y2="92" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function HotkeyIllustration({ size = 100 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden
      className="text-accent"
    >
      <defs>
        <radialGradient id="hk-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#5FE6FF" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#5FE6FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="55" fill="url(#hk-halo)" />
      {/* Key cap */}
      <rect
        x="28"
        y="36"
        width="64"
        height="44"
        rx="8"
        stroke="currentColor"
        strokeWidth="2"
        fill="#0c0e11"
      />
      <rect
        x="34"
        y="42"
        width="52"
        height="32"
        rx="5"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1"
        fill="none"
      />
      <text
        x="60"
        y="64"
        textAnchor="middle"
        fontSize="11"
        fontFamily="JetBrains Mono, monospace"
        fill="currentColor"
      >
        Ctrl
      </text>
      {/* Press indicator dots */}
      <circle cx="38" cy="92" r="2" fill="currentColor" opacity="0.6" />
      <circle cx="60" cy="96" r="2" fill="currentColor" />
      <circle cx="82" cy="92" r="2" fill="currentColor" opacity="0.6" />
    </svg>
  )
}

export function SparkleIllustration({ size = 100 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden
      className="text-accent"
    >
      <defs>
        <radialGradient id="sp-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#5FE6FF" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#5FE6FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="55" fill="url(#sp-halo)" />
      {/* Central spark */}
      <path
        d="M 60 30 L 64 56 L 90 60 L 64 64 L 60 90 L 56 64 L 30 60 L 56 56 Z"
        fill="currentColor"
      />
      {/* Small sparkles */}
      <path
        d="M 92 32 L 94 40 L 102 42 L 94 44 L 92 52 L 90 44 L 82 42 L 90 40 Z"
        fill="currentColor"
        opacity="0.6"
      />
      <path
        d="M 22 80 L 24 86 L 30 88 L 24 90 L 22 96 L 20 90 L 14 88 L 20 86 Z"
        fill="currentColor"
        opacity="0.5"
      />
    </svg>
  )
}
