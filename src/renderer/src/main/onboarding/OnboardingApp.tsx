import { useState, useCallback } from 'react'
import { StepWelcome } from './steps/StepWelcome'
import { StepMicrophone } from './steps/StepMicrophone'
import { StepHotkey } from './steps/StepHotkey'
import { StepTest } from './steps/StepTest'
import { Modal } from '../../shared/components/Modal'
import { Button } from '../../shared/components/Button'
import { getBridge } from '../../shared/hooks/useBridge'
import { FlowTypeMark } from '../shell/FlowTypeMark'

/**
 * OnboardingApp — root do wizard 4 passos.
 *
 * Aparece automaticamente quando `settings.first_run_completed === false`.
 * State local de currentStep (0..3); cada step decide se pode avançar
 * (mic permission obrigatória; key opcional via fallback amber).
 *
 * Skip onboarding: confirm modal antes; se confirma, marca
 * `first_run_completed = true` mesmo sem completar e chama onComplete.
 *
 * Conclude (step 4 success): marca `first_run_completed = true` e chama
 * onComplete pro App.tsx renderizar HomeView.
 */
export function OnboardingApp({
  onComplete
}: {
  onComplete: () => void
}): JSX.Element {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const bridge = getBridge()

  const next = useCallback((): void => {
    setStep((s) => (s < 3 ? ((s + 1) as 0 | 1 | 2 | 3) : s))
  }, [])

  const back = useCallback((): void => {
    setStep((s) => (s > 0 ? ((s - 1) as 0 | 1 | 2 | 3) : s))
  }, [])

  const requestSkip = useCallback((): void => {
    setConfirmSkip(true)
  }, [])

  const confirmSkipNow = useCallback(async (): Promise<void> => {
    setConfirmSkip(false)
    if (bridge) {
      try {
        await bridge.settings.set('first_run_completed', true)
      } catch {
        // swallow — UI still progresses
      }
    }
    onComplete()
  }, [bridge, onComplete])

  return (
    <div className="min-h-screen w-full bg-bg-0 flex items-center justify-center px-6 py-10">
      {/* Subtle ambient brand mark top-left, non-interactive */}
      <div className="absolute top-4 left-4 flex items-center gap-2 pointer-events-none select-none opacity-70">
        <FlowTypeMark size={18} />
        <span className="text-xs font-semibold tracking-tight text-text-secondary">
          Flow Type
        </span>
        <span className="text-[10px] font-mono text-text-faint">· configuração inicial</span>
      </div>

      {step === 0 ? <StepWelcome onNext={next} onSkip={requestSkip} /> : null}
      {step === 1 ? <StepMicrophone onNext={next} onBack={back} onSkip={requestSkip} /> : null}
      {step === 2 ? <StepHotkey onNext={next} onBack={back} onSkip={requestSkip} /> : null}
      {step === 3 ? <StepTest onFinish={onComplete} onBack={back} onSkip={requestSkip} /> : null}

      <Modal
        open={confirmSkip}
        onClose={() => setConfirmSkip(false)}
        title="Pular onboarding?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSkip(false)}>
              voltar
            </Button>
            <Button variant="primary" onClick={() => void confirmSkipNow()}>
              pular mesmo assim
            </Button>
          </>
        }
      >
        Você pode fazer essa configuração depois em Configurações. Sem a key Groq
        e a permissão de microfone, o Flow Type não vai funcionar — você verá um
        aviso na tela inicial.
      </Modal>
    </div>
  )
}
