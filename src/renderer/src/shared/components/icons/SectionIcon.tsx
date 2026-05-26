/**
 * Section icons for the Settings sidebar — outline SVGs, stroke 1.75.
 * Designed to match the cyan-accent design system and replace the
 * generic emoji set used in v0.1.0.
 */

import type { SVGProps } from 'react'

export type SectionIconName =
  | 'keyboard'
  | 'mic'
  | 'cloud'
  | 'globe'
  | 'book'
  | 'zap'
  | 'info'

const COMMON: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
}

export function SectionIcon({
  name,
  size = 16,
  className
}: {
  name: SectionIconName
  size?: number
  className?: string
}): JSX.Element {
  const props = { ...COMMON, width: size, height: size, className, 'aria-hidden': true }
  switch (name) {
    case 'keyboard':
      return (
        <svg {...props}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
        </svg>
      )
    case 'mic':
      return (
        <svg {...props}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
        </svg>
      )
    case 'cloud':
      return (
        <svg {...props}>
          <path d="M17.5 18a4.5 4.5 0 1 0-1.41-8.78A6 6 0 1 0 6 14.5h11.5z" />
        </svg>
      )
    case 'globe':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      )
    case 'book':
      return (
        <svg {...props}>
          <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5a2.5 2.5 0 0 0 0 5H20" />
          <path d="M4 4.5v15A2.5 2.5 0 0 0 6.5 22" />
        </svg>
      )
    case 'zap':
      return (
        <svg {...props}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
      )
    case 'info':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      )
  }
}
