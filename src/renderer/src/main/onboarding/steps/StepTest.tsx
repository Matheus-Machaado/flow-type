import { useCallback, useEffect, useMemo, useState } from 'react'
import { StepFrame } from '../components/StepFrame'
import { SparkleIllustration } from '../illustrations'
import { Button } from '../../../shared/components/Button'
import { Card } from '../../../shared/components/Card'
import { Badge } from '../../../shared/components/Badge'
import { Input } from '../../../shared/components/Input'
import { getBridge } from '../../../shared/hooks/useBridge'
import { cn } from '../../../shared/lib/cn'

/**
 * StepTest — passo 4/4 com CR-2 aplicado.
 *
 * Dois estados:
 *  A) sem key cadastrada: form inline (apelido + key gsk_...) → validar →
 *     revela botão "Gravar 5s e testar".
 *  B) com key cadastrada (ex: bootstrap .env via Zico): card "sua key Groq · online"
 *     + botão "Gravar 5s e testar" imediato.
 *
 * Após sucesso (texto apareceu): botão "Concluir ✓" verde habilitado.
 *
 * NUNCA mostra: "Slot #N", "3 slots", "pool", "round-robin", "Wispr",
 * CTA "adicione mais keys" (CR-2 — esse CTA SÓ existe na Settings depois).
 *
 * Concluir → settings.set('first_run_completed', true) → onFinish().
 */

type Phase = 'check' | 'need-key' | 'ready' | 'recording' | 'transcribing' | 'success' | 'error'

interface ProviderSnapshotMin {
  slots: {
    slots: Array<{
      hasKey: boolean
      label?: string | null
      apiKeyTail?: string
      status: 'online' | 'invalid' | 'exhausted'
    }>
  }
}

interface TestResult {
  text: string
  latencyMs: number
  provider: 'cloud' | 'local'
}

export function StepTest({
  onFinish,
  onBack,
  onSkip
}: {
  onFinish: () => void
  onBack: () => void
  onSkip: () => void
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>('check')
  const [keyInput, setKeyInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [savedKeyTail, setSavedKeyTail] = useState<string | null>(null)
  const [savedKeyLabel, setSavedKeyLabel] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const bridge = getBridge()

  // ── Detect existing key (state B vs A) ──────────────────────────────
  const loadProvider = useCallback(async (): Promise<void> => {
    if (!bridge) {
      // Demo mode: inspect mock if any.
      const mock =
        typeof window !== 'undefined' && window.__flowtypeMock?.providerSettings
          ? (window.__flowtypeMock.providerSettings as ProviderSnapshotMin)
          : null
      const existing = mock?.slots?.slots?.find((s) => s.hasKey)
      if (existing) {
        setSavedKeyTail(existing.apiKeyTail ?? 'xxxx')
        setSavedKeyLabel(existing.label ?? null)
        setPhase('ready')
      } else {
        setPhase('need-key')
      }
      return
    }
    try {
      const data = (await bridge.stt.getProviderSettings()) as ProviderSnapshotMin
      const existing = data?.slots?.slots?.find((s) => s.hasKey)
      if (existing) {
        setSavedKeyTail(existing.apiKeyTail ?? 'xxxx')
        setSavedKeyLabel(existing.label ?? null)
        setPhase('ready')
      } else {
        setPhase('need-key')
      }
    } catch {
      setPhase('need-key')
    }
  }, [bridge])

  useEffect(() => {
    void loadProvider()
  }, [loadProvider])

  // ── Validate + save key (state A) ───────────────────────────────────
  const canSubmit = useMemo(
    () => keyInput.startsWith('gsk_') && keyInput.length >= 20,
    [keyInput]
  )

  const submitKey = async (): Promise<void> => {
    if (!canSubmit) {
      setKeyError('A key precisa começar com gsk_ e ter pelo menos 20 caracteres.')
      return
    }
    setKeyError(null)
    setPhase('check')
    try {
      if (!bridge) {
        // Demo: just persist locally.
        setSavedKeyTail(keyInput.slice(-4))
        setSavedKeyLabel(labelInput || null)
        setPhase('ready')
        return
      }
      const r = (await bridge.stt.addSlot({
        slotIndex: 0,
        apiKey: keyInput,
        label: labelInput || undefined,
        dailyCap: 14400
      })) as { ok: boolean; validation: { error?: string } }
      if (!r.ok) {
        setKeyError(r.validation?.error ?? 'Key rejeitada pelo Groq')
        setPhase('need-key')
        return
      }
      setSavedKeyTail(keyInput.slice(-4))
      setSavedKeyLabel(labelInput || null)
      setPhase('ready')
    } catch {
      setKeyError('Erro de rede ao validar')
      setPhase('need-key')
    }
  }

  // ── Record + transcribe (state ready → recording → transcribing) ────
  const runTest = async (): Promise<void> => {
    if (phase === 'recording' || phase === 'transcribing') return
    setTestError(null)
    setTestResult(null)
    setPhase('recording')

    try {
      if (!bridge || typeof navigator === 'undefined' || !navigator.mediaDevices) {
        // Demo: simulate latency + canned result.
        await new Promise((r) => setTimeout(r, 1200))
        setPhase('transcribing')
        await new Promise((r) => setTimeout(r, 600))
        setTestResult({
          text: 'olá Flow Type, isso é um teste de transcrição',
          latencyMs: 720,
          provider: 'cloud'
        })
        setPhase('success')
        return
      }

      // Real capture: 5s @ MediaRecorder webm/opus.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (ev) => chunks.push(ev.data)
      recorder.start()
      await new Promise((r) => setTimeout(r, 5000))
      recorder.stop()
      await new Promise<void>((r) => (recorder.onstop = () => r()))
      stream.getTracks().forEach((t) => t.stop())

      setPhase('transcribing')
      const blob = new Blob(chunks, { type: 'audio/webm' })
      const buf = await blob.arrayBuffer()
      const r = (await bridge.stt.testTranscribe(buf)) as {
        text: string
        provider: string
        latencyMs: number
      }
      // Map provider string to user-facing label sem expor slot.
      const provider: 'cloud' | 'local' = r.provider === 'groq' ? 'cloud' : 'local'
      setTestResult({ text: r.text, latencyMs: r.latencyMs, provider })
      setPhase('success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'desconhecido'
      setTestError(msg)
      setPhase('error')
    }
  }

  const recordAgain = (): void => {
    setTestResult(null)
    setTestError(null)
    setPhase('ready')
  }

  // ── Finish (success path OR skip-test path) ─────────────────────────
  const finish = async (): Promise<void> => {
    if (finishing) return
    setFinishing(true)
    try {
      if (bridge) {
        await bridge.settings.set('first_run_completed', true)
      }
      onFinish()
    } finally {
      setFinishing(false)
    }
  }

  // The "Concluir" primary button at the bottom:
  //  - success: green ✓, enabled
  //  - ready (no test yet): disabled (encourage test)
  //  - need-key: hidden (we use submitKey first)
  // Skip-fallback "concluir mesmo assim" lives inline.
  const primaryDisabled = phase !== 'success'
  const primaryLabel = finishing ? 'finalizando…' : 'Concluir'

  return (
    <StepFrame
      stepIndex={3}
      totalSteps={4}
      title="Teste real"
      subtitle="Vamos testar. Cole sua key Groq (free) e faça uma transcrição real."
      primaryLabel={primaryLabel}
      primaryDisabled={primaryDisabled}
      primaryTone="success"
      onPrimary={() => void finish()}
      onBack={onBack}
      onSkip={onSkip}
      testId="onboarding-step-test"
    >
      <div className="space-y-4">
        <div className="flex justify-center mb-1">
          <SparkleIllustration size={92} />
        </div>

        {/* ── State A: need-key ──────────────────────────────────────── */}
        {phase === 'need-key' || phase === 'check' ? (
          <NeedKeyForm
            keyInput={keyInput}
            labelInput={labelInput}
            onKeyChange={setKeyInput}
            onLabelChange={setLabelInput}
            canSubmit={canSubmit}
            error={keyError}
            submitting={phase === 'check'}
            onSubmit={() => void submitKey()}
          />
        ) : null}

        {/* ── State B (or post-validation): key card + record ───────── */}
        {phase === 'ready' ||
        phase === 'recording' ||
        phase === 'transcribing' ||
        phase === 'success' ||
        phase === 'error' ? (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">Sua key Groq</span>
                <Badge tone="success" dot>
                  online
                </Badge>
              </div>
              <span className="text-[10px] font-mono text-text-muted">
                {savedKeyLabel ? `${savedKeyLabel} · ` : ''}gsk_•••••{savedKeyTail ?? 'xxxx'}
              </span>
            </div>

            <Button
              variant="accent-soft"
              size="md"
              className="w-full"
              onClick={() => void runTest()}
              disabled={phase === 'recording' || phase === 'transcribing'}
            >
              {phase === 'recording'
                ? 'gravando 5s…'
                : phase === 'transcribing'
                  ? 'transcrevendo…'
                  : phase === 'success' || phase === 'error'
                    ? 'gravar de novo'
                    : 'gravar 5s e testar'}
            </Button>

            {phase === 'recording' ? (
              <div
                className="mt-3 flex items-center justify-center gap-2 text-[11px] text-accent"
                role="status"
              >
                <span
                  aria-hidden
                  className="w-2 h-2 rounded-full bg-accent shadow-glow animate-pulse"
                />
                <span>fale qualquer frase, gravação termina em 5 segundos</span>
              </div>
            ) : null}

            {phase === 'transcribing' ? (
              <div
                className="mt-3 flex items-center justify-center gap-2 text-[11px] text-text-muted"
                role="status"
              >
                <span
                  aria-hidden
                  className="w-3 h-3 rounded-full border-2 border-accent border-r-transparent animate-spin"
                />
                <span>enviando pra Groq…</span>
              </div>
            ) : null}

            {phase === 'success' && testResult ? (
              <div className="mt-3 p-3 rounded-lg bg-bg-0 border border-success/30">
                <div className="text-[10px] uppercase tracking-wider text-text-faint font-mono mb-1">
                  resultado
                </div>
                <div className="text-sm text-text-primary italic leading-snug">
                  &ldquo;{testResult.text}&rdquo;
                </div>
                <div className="mt-2 text-[10px] font-mono text-text-muted">
                  Latência: <span className="text-accent">{testResult.latencyMs}ms</span>{' '}
                  · Provider: {testResult.provider}
                </div>
              </div>
            ) : null}

            {phase === 'error' ? (
              <div className="mt-3 p-3 rounded-lg bg-bg-0 border border-danger/30">
                <div className="text-[10px] uppercase tracking-wider text-danger font-mono mb-1">
                  erro
                </div>
                <div className="text-xs text-text-secondary">
                  Não foi possível transcrever: {testError ?? 'erro desconhecido'}
                </div>
                <Button variant="ghost" size="sm" onClick={recordAgain} className="mt-2 -ml-2">
                  tentar de novo
                </Button>
              </div>
            ) : null}
          </Card>
        ) : null}

        {/* ── Skip-test fallback (only shown if user wants to bail) ── */}
        {phase === 'ready' || phase === 'need-key' || phase === 'error' ? (
          <SkipTestFallback onFinish={() => void finish()} disabled={finishing} />
        ) : null}
      </div>
    </StepFrame>
  )
}

// ─── Sub: NeedKeyForm ────────────────────────────────────────────────

function NeedKeyForm({
  keyInput,
  labelInput,
  onKeyChange,
  onLabelChange,
  canSubmit,
  error,
  submitting,
  onSubmit
}: {
  keyInput: string
  labelInput: string
  onKeyChange: (v: string) => void
  onLabelChange: (v: string) => void
  canSubmit: boolean
  error: string | null
  submitting: boolean
  onSubmit: () => void
}): JSX.Element {
  const openGroqConsole = (): void => {
    const url = 'https://console.groq.com'
    if (typeof window !== 'undefined') {
      // electron: shell.openExternal would be ideal; bridge.app exposes openExternal?
      // For now fallback to window.open which Electron handles via shell when target=_blank.
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <Card className="p-4 border-accent/30">
      <div className="mb-3">
        <div className="text-xs font-medium text-text-primary">Sua key Groq</div>
        <div className="text-[11px] text-text-muted mt-1 leading-relaxed">
          Free, sem cartão. Crie em{' '}
          <button
            type="button"
            onClick={openGroqConsole}
            className="text-accent hover:text-accent-2 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            console.groq.com
          </button>{' '}
          em ~30 segundos.
        </div>
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={openGroqConsole}>
            ↗ Abrir console.groq.com
          </Button>
        </div>
      </div>

      <div className="space-y-3 pt-3 border-t border-border">
        <Input
          label="API key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          placeholder="gsk_xxxxxxxxxxxxxxxx"
          value={keyInput}
          onChange={(e) => onKeyChange(e.target.value.trim())}
          invalid={Boolean(error && !canSubmit)}
          hint="Validamos antes de salvar."
        />
        <Input
          label="Apelido (opcional)"
          placeholder="ex: pessoal"
          maxLength={32}
          value={labelInput}
          onChange={(e) => onLabelChange(e.target.value)}
        />

        {error ? (
          <div className="text-[11px] text-danger" role="alert">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={!canSubmit || submitting}
            className={cn(submitting && 'opacity-80')}
            size="md"
          >
            {submitting ? 'validando…' : 'validar e salvar'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ─── Sub: SkipTestFallback (amber warning) ───────────────────────────

function SkipTestFallback({
  onFinish,
  disabled
}: {
  onFinish: () => void
  disabled: boolean
}): JSX.Element {
  return (
    <Card className="p-3 border-warning/30 bg-warning/5">
      <div className="flex gap-2 items-start">
        <span aria-hidden className="text-warning text-sm leading-none mt-0.5">
          !
        </span>
        <div className="text-[11px] text-text-secondary leading-relaxed flex-1">
          O app vai funcionar com limitações até cadastrar a key Groq ou instalar
          Python 3.11+ pro fallback local. Você pode fazer isso depois em Configurações
          → STT Provider.
          <div className="mt-2">
            <Button variant="ghost" size="sm" onClick={onFinish} disabled={disabled}>
              concluir mesmo assim
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
