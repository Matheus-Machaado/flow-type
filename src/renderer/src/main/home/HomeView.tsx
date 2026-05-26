import { useEffect, useState } from 'react'
import { Card } from '../../shared/components/Card'
import { Button } from '../../shared/components/Button'
import { Badge } from '../../shared/components/Badge'
import { Toggle } from '../../shared/components/Toggle'
import { getBridge } from '../../shared/hooks/useBridge'
import { FlowTypeMark } from '../shell/FlowTypeMark'
import type { RouteId } from '../App'

interface SettingsShape {
  hotkey?: string
  auto_start?: boolean
  muted?: boolean
}

/**
 * HomeView — landing da main window. Mostra brand "Flow Type", hotkey atual,
 * 3 toggles principais e atalhos pras outras rotas. Sem react-router, recebe
 * `onNavigate` do MainApp.
 */
export function HomeView({ onNavigate }: { onNavigate: (to: RouteId) => void }): JSX.Element {
  const [settings, setSettings] = useState<SettingsShape>({
    hotkey: 'Right Ctrl',
    auto_start: false,
    muted: false
  })
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)
  const bridge = getBridge()

  useEffect(() => {
    if (!bridge) {
      // Demo mode (screenshot harness).
      setOnboardingDone(true)
      return
    }
    void (async () => {
      try {
        const all = (await bridge.settings.getAll()) as SettingsShape
        setSettings((p) => ({ ...p, ...all }))
        const ob = (await bridge.app.onboardingStatus()) as { completed: boolean } | null
        setOnboardingDone(Boolean(ob?.completed))
      } catch {
        setOnboardingDone(true)
      }
    })()
    return bridge.settings.onChange((key, value) => {
      setSettings((p) => ({ ...p, [key]: value as unknown }))
    })
  }, [bridge])

  const toggleAutoStart = async (next: boolean): Promise<void> => {
    setSettings((p) => ({ ...p, auto_start: next }))
    if (bridge) await bridge.app.autoStartSet(next)
  }

  const toggleMute = async (next: boolean): Promise<void> => {
    setSettings((p) => ({ ...p, muted: next }))
    if (bridge) await bridge.app.toggleMute()
  }

  return (
    <main
      className="flex-1 overflow-y-auto px-8 py-8 max-w-4xl mx-auto w-full"
      role="main"
      aria-label="Flow Type — início"
    >
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <FlowTypeMark size={40} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
              Flow Type
            </h1>
            <p className="text-sm text-text-secondary">
              Sua voz vira texto onde você estiver.
            </p>
          </div>
          {onboardingDone === false ? (
            <Badge tone="warning" className="ml-auto">
              configure
            </Badge>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-text-faint uppercase tracking-wider">
              hotkey ativa
            </span>
            <Badge tone={settings.muted ? 'muted' : 'success'} dot>
              {settings.muted ? 'silenciado' : 'ativo'}
            </Badge>
          </div>
          <div className="flex items-baseline gap-2">
            <code className="px-2.5 py-1 rounded-md bg-surface text-accent font-mono text-sm border border-border">
              {settings.hotkey ?? 'Right Ctrl'}
            </code>
            <span className="text-[10px] text-text-muted">
              segure pra gravar, solte pra enviar
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate('settings')}
            className="mt-3"
          >
            mudar hotkey
          </Button>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-text-faint uppercase tracking-wider">
              ações rápidas
            </span>
          </div>
          <div className="space-y-2">
            <Row
              label="Iniciar com o Windows"
              control={
                <Toggle
                  on={Boolean(settings.auto_start)}
                  onChange={toggleAutoStart}
                  ariaLabel="Iniciar Flow Type com o Windows"
                />
              }
            />
            <Row
              label="Silenciar hotkey"
              control={
                <Toggle
                  on={Boolean(settings.muted)}
                  onChange={toggleMute}
                  ariaLabel="Silenciar hotkey do Flow Type"
                />
              }
            />
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ShortcutCard
          title="Transcrições"
          description="Veja o que foi ditado nas últimas horas."
          cta="abrir histórico"
          onClick={() => onNavigate('history')}
        />
        <ShortcutCard
          title="STT e provedores"
          description="Configure sua key Groq ou habilite fallback local."
          cta="abrir configurações"
          onClick={() => onNavigate('settings')}
        />
        <ShortcutCard
          title="Vocabulário"
          description="Correções automáticas pós-transcrição (nomes, termos)."
          cta="gerenciar vocabulário"
          onClick={() => onNavigate('settings')}
        />
      </section>

      <footer className="mt-12 pt-6 border-t border-border text-[11px] text-text-muted">
        Flow Type roda em segundo plano no canto da tela. Use o ícone na
        bandeja pra abrir esta janela ou sair.
      </footer>
    </main>
  )
}

function Row({
  label,
  control
}: {
  label: string
  control: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-text-secondary">{label}</span>
      {control}
    </div>
  )
}

function ShortcutCard({
  title,
  description,
  cta,
  onClick
}: {
  title: string
  description: string
  cta: string
  onClick: () => void
}): JSX.Element {
  return (
    <Card interactive className="p-4 flex flex-col gap-2">
      <div className="text-sm font-medium text-text-primary">{title}</div>
      <p className="text-[11px] text-text-muted leading-relaxed flex-1">
        {description}
      </p>
      <Button variant="accent-soft" size="sm" onClick={onClick}>
        {cta}
      </Button>
    </Card>
  )
}
