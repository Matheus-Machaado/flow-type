import { useEffect, useState } from 'react'
import { StepFrame } from '../components/StepFrame'
import { HotkeyIllustration } from '../illustrations'
import { Button } from '../../../shared/components/Button'
import { Card } from '../../../shared/components/Card'
import { Badge } from '../../../shared/components/Badge'
import { HotkeyCapture } from '../../settings/HotkeyCapture'
import { getBridge } from '../../../shared/hooks/useBridge'
import { cn } from '../../../shared/lib/cn'

type TestState = 'idle' | 'armed' | 'released'

/**
 * StepHotkey — passo 3/4. Card destacando Right Ctrl default; permite trocar
 * via HotkeyCapture; oferece "Testar segurando+soltando" que escuta
 * `hotkey:armed` / `hotkey:released` IPC.
 *
 * Sem bridge (modo demo / harness): teste cai num fallback que reage a
 * keydown/keyup do próprio renderer escutando a hotkey configurada.
 * Importante pro screenshot — não precisa Electron pra renderizar.
 */
export function StepHotkey({
  onNext,
  onBack,
  onSkip
}: {
  onNext: () => void
  onBack: () => void
  onSkip: () => void
}): JSX.Element {
  const [hotkey, setHotkey] = useState<string>('Right Ctrl')
  const [testState, setTestState] = useState<TestState>('idle')
  const [holdMs, setHoldMs] = useState<number | null>(null)
  const bridge = getBridge()

  // Load current hotkey from settings on mount.
  useEffect(() => {
    if (!bridge) return
    void (async () => {
      try {
        const all = (await bridge.settings.getAll()) as { hotkey?: string }
        if (all.hotkey) setHotkey(all.hotkey)
      } catch {
        // keep default
      }
    })()
  }, [bridge])

  // Subscribe to hotkey events (IPC) when bridge present.
  useEffect(() => {
    if (!bridge) return
    const offArmed = bridge.hotkey.onArmed(() => {
      setTestState('armed')
      setHoldMs(null)
    })
    const offReleased = bridge.hotkey.onReleased((p) => {
      setTestState('released')
      setHoldMs(p.holdDurationMs)
    })
    return () => {
      offArmed()
      offReleased()
    }
  }, [bridge])

  // Renderer-fallback test (no bridge): listen for the configured key in
  // the renderer window. Only used when running outside Electron (audit
  // harness / preview server). We approximate Right Ctrl with key === 'Control'
  // and event.code === 'ControlRight'.
  useEffect(() => {
    if (bridge) return
    const isRightCtrl = hotkey.toLowerCase().includes('right ctrl')
    let armedAt = 0
    function onDown(e: KeyboardEvent): void {
      if (e.repeat) return
      const match = isRightCtrl
        ? e.code === 'ControlRight'
        : e.key.toLowerCase() === hotkey.toLowerCase()
      if (!match) return
      armedAt = Date.now()
      setTestState('armed')
      setHoldMs(null)
    }
    function onUp(e: KeyboardEvent): void {
      const match = isRightCtrl
        ? e.code === 'ControlRight'
        : e.key.toLowerCase() === hotkey.toLowerCase()
      if (!match || armedAt === 0) return
      const dur = Date.now() - armedAt
      armedAt = 0
      setTestState('released')
      setHoldMs(dur)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [bridge, hotkey])

  const updateHotkey = async (combo: string): Promise<void> => {
    setHotkey(combo)
    if (bridge) {
      try {
        await bridge.hotkey.setBinding(combo)
      } catch {
        // swallow — UI já refletiu local; main process loga erro
      }
    }
    // Reset test state após mudança.
    setTestState('idle')
    setHoldMs(null)
  }

  const resetTest = (): void => {
    setTestState('idle')
    setHoldMs(null)
  }

  return (
    <StepFrame
      stepIndex={2}
      totalSteps={4}
      title="Calibração de hotkey"
      subtitle="A tecla pra ativar transcrição. Padrão: Right Ctrl — raramente usada, não bate com nada."
      primaryLabel="Próximo"
      onPrimary={onNext}
      onBack={onBack}
      onSkip={onSkip}
      testId="onboarding-step-hotkey"
    >
      <div className="space-y-5">
        <div className="flex justify-center">
          <HotkeyIllustration size={104} />
        </div>

        {/* Hotkey display card */}
        <Card className="p-4 border-accent/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-faint font-mono mb-1">
                tecla atual
              </div>
              <div className="flex items-baseline gap-2">
                <strong className="text-lg font-mono font-semibold text-accent">
                  {hotkey}
                </strong>
                <span className="text-[10px] text-text-muted">
                  raramente usada — não bate com nada
                </span>
              </div>
            </div>
            <HotkeyCapture current={hotkey} onSave={updateHotkey} />
          </div>
        </Card>

        {/* Test area */}
        <Card
          className={cn(
            'p-4 transition-colors',
            testState === 'armed' && 'border-accent/50 bg-accent/5',
            testState === 'released' && 'border-success/50 bg-success/5'
          )}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-medium text-text-primary">
              Teste segurando + soltando
            </div>
            {testState === 'idle' ? (
              <Badge tone="muted">aguardando</Badge>
            ) : testState === 'armed' ? (
              <Badge tone="accent" dot>
                armada
              </Badge>
            ) : (
              <Badge tone="success" dot>
                solta
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className={cn(
                'w-3 h-3 rounded-full transition-all',
                testState === 'idle' && 'bg-text-faint/40',
                testState === 'armed' &&
                  'bg-accent shadow-[0_0_12px_rgba(95,230,255,0.7)] animate-pulse',
                testState === 'released' &&
                  'bg-success shadow-[0_0_10px_rgba(52,211,153,0.6)]'
              )}
            />
            <p className="text-[11px] text-text-secondary leading-relaxed flex-1">
              {testState === 'idle'
                ? `Segure ${hotkey} agora pra ver o indicador acender. Solte pra confirmar.`
                : testState === 'armed'
                  ? 'Captando… solte a tecla quando estiver pronto.'
                  : `Funcionou! Mantida por ${holdMs ?? '—'}ms.`}
            </p>
            {testState === 'released' ? (
              <Button variant="ghost" size="sm" onClick={resetTest}>
                testar de novo
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    </StepFrame>
  )
}
