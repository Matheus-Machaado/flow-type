import { useCallback, useEffect, useState } from 'react'
import { cn } from '../../shared/lib/cn'
import { getBridge } from '../../shared/hooks/useBridge'
import { SectionIcon, type SectionIconName } from '../../shared/components/icons/SectionIcon'
import { HotkeySection } from './sections/HotkeySection'
import { MicrofoneSection } from './sections/MicrofoneSection'
import { GroqProviderSection } from './sections/GroqProviderSection'
import { IdiomaSection } from './sections/IdiomaSection'
import { VocabularioSection } from './sections/VocabularioSection'
import { AutoStartSection } from './sections/AutoStartSection'
import { SobreSection } from './sections/SobreSection'

/**
 * SettingsApp — janela settings completa, renderizada DENTRO do main window
 * (não window separada). Sidebar 7 seções, cada uma em arquivo dedicado.
 *
 * Auto-save: cada controle persiste imediato via IPC.
 *
 * Brand visível: "Flow Type" no header da janela (vem do TopBar parent).
 * Aqui só labels técnicos curtos.
 */

type SectionId =
  | 'hotkey'
  | 'microfone'
  | 'stt'
  | 'idioma'
  | 'vocab'
  | 'autostart'
  | 'sobre'

interface SectionMeta {
  id: SectionId
  label: string
  icon: SectionIconName
  description: string
}

const SECTIONS: SectionMeta[] = [
  {
    id: 'hotkey',
    label: 'Hotkey',
    icon: 'keyboard',
    description: 'Tecla que arma a captura de voz.'
  },
  {
    id: 'microfone',
    label: 'Microfone',
    icon: 'mic',
    description: 'Dispositivo de captura de áudio.'
  },
  {
    id: 'stt',
    label: 'STT Provider',
    icon: 'cloud',
    description: 'Provedor de transcrição (cloud + fallback local).'
  },
  {
    id: 'idioma',
    label: 'Idioma',
    icon: 'globe',
    description: 'Idioma do áudio.'
  },
  {
    id: 'vocab',
    label: 'Vocabulário',
    icon: 'book',
    description: 'Correções aplicadas após a transcrição.'
  },
  {
    id: 'autostart',
    label: 'Auto-start',
    icon: 'zap',
    description: 'Iniciar com o Windows.'
  },
  {
    id: 'sobre',
    label: 'Sobre',
    icon: 'info',
    description: 'Versão e links.'
  }
]

export function SettingsApp({
  initialSection = 'stt'
}: {
  initialSection?: SectionId
}): JSX.Element {
  const [section, setSection] = useState<SectionId>(initialSection)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const bridge = getBridge()

  // Listen to settings changes to refresh "salvo às" indicator.
  useEffect(() => {
    if (!bridge) return
    return bridge.settings.onChange(() => markSaved())
  }, [bridge])

  const markSaved = useCallback((): void => {
    const time = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    })
    setSavedAt(time)
  }, [])

  const meta = SECTIONS.find((s) => s.id === section)!

  return (
    <div className="flex-1 flex min-h-0 flex-col">
      <div className="flex-1 flex min-h-0">
        <Sidebar active={section} onSelect={setSection} />
        <main
          className="flex-1 overflow-y-auto px-6 py-6"
          role="main"
          aria-label={`Configurações — ${meta.label}`}
        >
          <SectionShell title={meta.label} description={meta.description}>
            {section === 'hotkey' ? <HotkeySection onSaved={markSaved} /> : null}
            {section === 'microfone' ? <MicrofoneSection /> : null}
            {section === 'stt' ? <GroqProviderSection onSaved={markSaved} /> : null}
            {section === 'idioma' ? <IdiomaSection onSaved={markSaved} /> : null}
            {section === 'vocab' ? <VocabularioSection /> : null}
            {section === 'autostart' ? <AutoStartSection onSaved={markSaved} /> : null}
            {section === 'sobre' ? <SobreSection /> : null}
          </SectionShell>
        </main>
      </div>
      <StatusBar savedAt={savedAt} />
    </div>
  )
}

function Sidebar({
  active,
  onSelect
}: {
  active: SectionId
  onSelect: (s: SectionId) => void
}): JSX.Element {
  return (
    <nav
      aria-label="Seções de configuração"
      className="w-48 shrink-0 border-r border-border bg-bg-1 p-3 space-y-0.5"
    >
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          aria-current={active === s.id ? 'page' : undefined}
          className={cn(
            'w-full text-left px-2.5 py-2 rounded text-xs flex items-center gap-2 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            active === s.id
              ? 'bg-surface text-accent border border-accent/30'
              : 'text-text-muted hover:bg-bg-2 hover:text-text-secondary border border-transparent'
          )}
        >
          <span className="w-4 flex items-center justify-center text-current">
            <SectionIcon name={s.icon} size={15} />
          </span>
          <span>{s.label}</span>
        </button>
      ))}
    </nav>
  )
}

function SectionShell({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-xs text-text-muted mt-1">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function StatusBar({ savedAt }: { savedAt: string | null }): JSX.Element {
  return (
    <footer className="h-7 px-3 border-t border-border bg-bg-1 flex items-center gap-3 text-[10px] font-mono text-text-muted shrink-0">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(52,211,153,0.55)]"
        />
        auto-save ativo
      </span>
      <span className="text-text-faint">·</span>
      <span>tudo persiste imediato</span>
      {savedAt ? (
        <span className="ml-auto text-accent">salvo às {savedAt}</span>
      ) : null}
    </footer>
  )
}
