import { useEffect, useState } from 'react'
import { cn } from '../../../shared/lib/cn'
import { getBridge } from '../../../shared/hooks/useBridge'

const LANGUAGES: { code: string | null; label: string; flag: string }[] = [
  { code: null, label: 'Auto-detectar', flag: '✦' },
  { code: 'pt-BR', label: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'en-US', label: 'English (US)', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' }
]

/**
 * IdiomaSection — escolha idioma do áudio. Auto-detect usa o próprio Whisper.
 */
export function IdiomaSection({ onSaved }: { onSaved?: () => void }): JSX.Element {
  const [language, setLanguage] = useState<string | null>(null)
  const bridge = getBridge()

  useEffect(() => {
    if (!bridge) return
    void (async () => {
      try {
        const stt = (await bridge.stt.getProviderSettings()) as { stt_language: string | null }
        setLanguage(stt.stt_language ?? null)
      } catch {
        // bridge offline; manter default
      }
    })()
  }, [bridge])

  const update = async (code: string | null): Promise<void> => {
    setLanguage(code)
    if (bridge) await bridge.stt.setLanguage(code)
    onSaved?.()
  }

  return (
    <div className="grid grid-cols-1 gap-1.5">
      {LANGUAGES.map((lang) => (
        <button
          key={String(lang.code)}
          type="button"
          onClick={() => void update(lang.code)}
          aria-pressed={language === lang.code}
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            language === lang.code
              ? 'bg-accent/10 border-accent/40 text-accent'
              : 'bg-bg-2 border-border text-text-secondary hover:text-text-primary hover:bg-surface'
          )}
        >
          <span className="text-base" aria-hidden>
            {lang.flag}
          </span>
          <span className="text-xs">{lang.label}</span>
          {lang.code ? (
            <span className="ml-auto text-[10px] text-text-faint font-mono">
              {lang.code}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
