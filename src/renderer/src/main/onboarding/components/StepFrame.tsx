import { cn } from '../../../shared/lib/cn'
import { Button } from '../../../shared/components/Button'
import { DotNav } from './DotNav'

/**
 * StepFrame — frame compartilhado por todos os 4 passos do wizard.
 *
 * Estrutura: top bar (dot nav + step label + skip discreto) → corpo
 * (children) → footer (voltar + próximo). Footer omite "voltar" no
 * step 0 e renomeia "próximo" pra "concluir" no último.
 *
 * Skip discreto top-right SEMPRE visível: dispara onSkip; caller decide
 * se confirma antes (ex: passos avançados).
 */
export function StepFrame({
  stepIndex,
  totalSteps,
  title,
  subtitle,
  children,
  primaryLabel,
  primaryDisabled,
  primaryTone = 'accent',
  onPrimary,
  onBack,
  onSkip,
  showSkip = true,
  testId
}: {
  stepIndex: number
  totalSteps: number
  title: string
  subtitle?: string
  children: React.ReactNode
  primaryLabel: string
  primaryDisabled?: boolean
  primaryTone?: 'accent' | 'success'
  onPrimary: () => void
  onBack?: () => void
  onSkip?: () => void
  showSkip?: boolean
  testId?: string
}): JSX.Element {
  const isFirst = stepIndex === 0
  const isLast = stepIndex === totalSteps - 1

  return (
    <section
      className="w-full max-w-[720px] mx-auto bg-bg-1 border border-border rounded-xl shadow-overlay overflow-hidden flex flex-col"
      style={{ minHeight: '560px' }}
      data-testid={testId}
      aria-labelledby="onboarding-step-title"
    >
      {/* Top bar — dot nav + step label + skip */}
      <header className="h-12 px-6 flex items-center justify-between border-b border-border bg-bg-2 shrink-0">
        <DotNav current={stepIndex} total={totalSteps} />
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-mono text-text-muted">
            Passo {stepIndex + 1} de {totalSteps}
          </span>
          {showSkip && onSkip ? (
            <button
              type="button"
              onClick={onSkip}
              className="text-[10px] text-text-faint hover:text-text-muted underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1"
            >
              pular onboarding
            </button>
          ) : null}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 px-10 py-8 overflow-y-auto">
        <div className="max-w-md mx-auto">
          <h2
            id="onboarding-step-title"
            className="text-2xl font-semibold tracking-tight text-text-primary"
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">{subtitle}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
      </div>

      {/* Footer */}
      <footer className="h-14 px-6 flex items-center justify-between border-t border-border bg-bg-2 shrink-0">
        <div>
          {!isFirst && onBack ? (
            <Button variant="ghost" onClick={onBack} size="md">
              ← Voltar
            </Button>
          ) : (
            <span />
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={onPrimary}
            disabled={primaryDisabled}
            size="md"
            className={cn(
              primaryTone === 'success' && !primaryDisabled
                ? 'bg-success text-bg-0 hover:bg-success/90 border-success/0'
                : ''
            )}
          >
            {primaryLabel} {isLast ? '✓' : '→'}
          </Button>
        </div>
      </footer>
    </section>
  )
}
