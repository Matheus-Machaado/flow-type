/**
 * Icon library — outline SVGs in the Flow Type design system.
 * Stroke 1.75 · viewBox 24 · uses currentColor. All glyphs in one place,
 * one consistent visual language.
 *
 * SectionIcon.tsx re-exports `Icon` for legacy callers; new code should
 * import directly from this file.
 */

import type { SVGProps } from 'react'

export type IconName =
  // Settings sidebar (keep these in sync with SectionIcon backward-compat)
  | 'keyboard'
  | 'mic'
  | 'cloud'
  | 'globe'
  | 'book'
  | 'zap'
  | 'info'
  // History + interactions
  | 'search'
  | 'play'
  | 'edit'
  | 'copy'
  | 'trash'
  | 'check'
  | 'alert-triangle'
  | 'arrow-right'
  | 'external'
  | 'terminal'
  | 'x'
  | 'plus'
  | 'message'
  | 'file-text'
  | 'code'

const COMMON: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
}

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}): JSX.Element {
  const props = {
    ...COMMON,
    ...(strokeWidth ? { strokeWidth } : {}),
    width: size,
    height: size,
    className,
    'aria-hidden': true
  }
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
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      )
    case 'play':
      return (
        <svg {...props}>
          <path d="M6 4v16l14-8z" />
        </svg>
      )
    case 'edit':
      return (
        <svg {...props}>
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
        </svg>
      )
    case 'copy':
      return (
        <svg {...props}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...props}>
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />
        </svg>
      )
    case 'check':
      return (
        <svg {...props}>
          <path d="M5 13l4 4L19 7" />
        </svg>
      )
    case 'alert-triangle':
      return (
        <svg {...props}>
          <path d="M12 3 2 21h20L12 3zM12 10v5M12 18h.01" />
        </svg>
      )
    case 'arrow-right':
      return (
        <svg {...props}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      )
    case 'external':
      return (
        <svg {...props}>
          <path d="M14 4h6v6M20 4 10 14M19 13v6H5V5h6" />
        </svg>
      )
    case 'terminal':
      return (
        <svg {...props}>
          <path d="M4 17l6-6-6-6M12 19h8" />
        </svg>
      )
    case 'x':
      return (
        <svg {...props}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'message':
      return (
        <svg {...props}>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      )
    case 'file-text':
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" />
        </svg>
      )
    case 'code':
      return (
        <svg {...props}>
          <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
        </svg>
      )
  }
}
