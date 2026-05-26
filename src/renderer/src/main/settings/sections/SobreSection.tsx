import { Badge } from '../../../shared/components/Badge'
import { Button } from '../../../shared/components/Button'
import { Card } from '../../../shared/components/Card'
import { FlowTypeMark } from '../../shell/FlowTypeMark'

/**
 * SobreSection — versão, links externos. Brand "Flow Type" capitalized.
 * Zero menção a concorrentes.
 */
export function SobreSection(): JSX.Element {
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <FlowTypeMark size={32} />
          <div>
            <div className="text-sm font-semibold text-text-primary">Flow Type</div>
            <div className="text-[10px] text-text-muted font-mono">v0.1.0</div>
          </div>
          <Badge tone="accent" className="ml-auto">
            preview
          </Badge>
        </div>
        <div className="text-xs text-text-secondary leading-relaxed">
          Ditado universal pra Windows. Sua voz vira texto onde você estiver —
          mensageiros, terminais, editores, IDEs. Cloud por padrão (Groq) ou
          local (faster-whisper) quando offline.
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={() => window.open('https://flowtype.app', '_blank', 'noopener')}
          >
            site
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              window.open('https://flowtype.app/faq', '_blank', 'noopener')
            }
          >
            faq
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              window.open('https://github.com/flowtype/flowtype', '_blank', 'noopener')
            }
          >
            github
          </Button>
        </div>
      </Card>

      <Card className="p-3.5 space-y-1.5">
        <div className="text-[10px] font-mono text-text-faint uppercase tracking-wider">
          ⌘ atalhos
        </div>
        <KeyRow combo="Right Ctrl" desc="segure pra gravar (configurável)" />
        <KeyRow combo="Ctrl+K" desc="busca rápida no histórico" />
        <KeyRow combo="Esc" desc="cancela gravação em andamento" />
      </Card>

      <p className="text-[10px] text-text-faint font-mono">
        feito para voz humana. roda em segundo plano no tray.
      </p>
    </div>
  )
}

function KeyRow({ combo, desc }: { combo: string; desc: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <code className="px-1.5 py-0.5 rounded bg-surface text-accent font-mono text-[10px] border border-border">
        {combo}
      </code>
      <span className="text-text-muted">{desc}</span>
    </div>
  )
}
