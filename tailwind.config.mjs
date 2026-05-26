/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/*.html',
    './src/renderer/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        'bg-0': '#060708',
        'bg-1': '#0c0e11',
        'bg-2': '#14171c',
        surface: '#1a1e25',
        'surface-hi': '#232830',

        // Accent — cyan elétrico
        accent: '#5FE6FF',
        'accent-2': '#B8FFEE',
        'accent-deep': '#1A8FA8',

        // Slots
        'slot-1': '#5FE6FF',
        'slot-2': '#7DD3FC',
        'slot-3': '#A5B4FC',
        'slot-local': '#FBBF24',

        // Text
        'text-primary': '#E8ECEF',
        'text-secondary': '#B5BCC4',
        'text-muted': '#7C8590',
        'text-faint': '#4A525C',
        'text-on-accent': '#051820',

        // Semantic
        success: '#34D399',
        warning: '#FBBF24',
        danger: '#F87171',
        info: '#60A5FA',

        // Borders
        border: '#1f242c',
        'border-strong': '#2c333d'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      boxShadow: {
        overlay: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(95,230,255,0.08)',
        glow: '0 0 24px rgba(95,230,255,0.18)'
      },
      animation: {
        'idle-breathe': 'idleBreathe 2s ease-in-out infinite',
        'armed-pulse': 'armedPulse 600ms ease-in-out infinite',
        spin: 'spin 1s linear infinite',
        'badge-in': 'badgeIn 150ms ease-out forwards',
        'badge-out': 'badgeOut 300ms ease-in forwards',
        'modal-fade': 'modalFade 150ms ease-out forwards',
        'modal-scale': 'modalScale 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards'
      },
      keyframes: {
        idleBreathe: {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '0.6' }
        },
        armedPulse: {
          '0%, 100%': {
            transform: 'scale(1)',
            boxShadow: '0 0 0 0 rgba(95,230,255,0.55)'
          },
          '50%': {
            transform: 'scale(1.3)',
            boxShadow: '0 0 0 12px rgba(95,230,255,0)'
          }
        },
        badgeIn: {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        badgeOut: {
          from: { opacity: '1' },
          to: { opacity: '0' }
        },
        modalFade: {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        modalScale: {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' }
        }
      }
    }
  },
  plugins: []
}
