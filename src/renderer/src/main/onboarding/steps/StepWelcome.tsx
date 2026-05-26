import { StepFrame } from '../components/StepFrame'
import { WelcomeWaveIllustration } from '../illustrations'

/**
 * StepWelcome — passo 1/4. Hero centralizado + 3 pilares condensados.
 *
 * Sem validação; "Começar" sempre habilitado. Skip onboarding fica
 * no top-right do StepFrame (link discreto).
 */
export function StepWelcome({
  onNext,
  onSkip
}: {
  onNext: () => void
  onSkip: () => void
}): JSX.Element {
  return (
    <StepFrame
      stepIndex={0}
      totalSteps={4}
      title="Bem-vindo ao Flow Type"
      subtitle="Em 4 passos rápidos, você vai estar transcrevendo voz em qualquer app."
      primaryLabel="Começar"
      onPrimary={onNext}
      onSkip={onSkip}
      testId="onboarding-step-welcome"
    >
      <div className="flex flex-col items-center text-center">
        <div className="mt-2 mb-2">
          <WelcomeWaveIllustration size={180} />
        </div>

        <div className="w-full grid grid-cols-3 gap-3 mt-6">
          <Pillar title="Free, sem cap" body="Sem cartão. Sem limite mensal." />
          <Pillar title="Qualquer app" body="Cola onde você está digitando." />
          <Pillar title="Privacy-aware" body="Fallback local sempre disponível." />
        </div>
      </div>
    </StepFrame>
  )
}

function Pillar({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="bg-bg-2 border border-border rounded-lg p-3 text-left">
      <div className="text-[11px] font-semibold text-accent tracking-wide">{title}</div>
      <div className="text-[10px] text-text-muted mt-1 leading-relaxed">{body}</div>
    </div>
  )
}
