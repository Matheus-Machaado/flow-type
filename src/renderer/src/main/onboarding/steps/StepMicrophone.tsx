import { useCallback, useEffect, useRef, useState } from 'react'
import { StepFrame } from '../components/StepFrame'
import { VolumeMeter } from '../components/VolumeMeter'
import { MicIllustration } from '../illustrations'
import { Button } from '../../../shared/components/Button'
import { Card } from '../../../shared/components/Card'

type PermissionState = 'idle' | 'requesting' | 'granted' | 'denied'

/**
 * StepMicrophone — passo 2/4. Pede permissão de microfone, lista devices
 * disponíveis, mostra volume meter live.
 *
 * Estados:
 *  - idle: botão "Permitir acesso ao microfone"
 *  - requesting: spinner while getUserMedia roda
 *  - granted: dropdown de devices + meter live + Próximo habilitado
 *  - denied: instruções pra reabilitar manualmente em Settings do Windows
 *
 * Cleanup: stream parado quando user volta/avança ou unmount.
 */
export function StepMicrophone({
  onNext,
  onBack,
  onSkip,
  onDeviceSelected
}: {
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onDeviceSelected?: (deviceId: string) => void
}): JSX.Element {
  const [permission, setPermission] = useState<PermissionState>('idle')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedId, setSelectedId] = useState<string>('default')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const requestMic = useCallback(
    async (deviceId?: string): Promise<void> => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
        setPermission('denied')
        setErrorDetail('API mediaDevices indisponível neste ambiente.')
        return
      }
      setPermission('requesting')
      setErrorDetail(null)
      try {
        // Stop previous stream if switching devices.
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
          streamRef.current = null
        }
        const constraints: MediaStreamConstraints = {
          audio: deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true
        }
        const s = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = s
        setStream(s)
        setPermission('granted')

        // Enumerate AFTER granted (browsers só populam labels após permissão).
        try {
          const all = await navigator.mediaDevices.enumerateDevices()
          setDevices(all.filter((d) => d.kind === 'audioinput'))
        } catch {
          setDevices([])
        }
      } catch (e) {
        setPermission('denied')
        const msg = e instanceof Error ? e.message : 'desconhecido'
        setErrorDetail(msg)
      }
    },
    []
  )

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  const onDeviceChange = (id: string): void => {
    setSelectedId(id)
    onDeviceSelected?.(id)
    void requestMic(id)
  }

  const handleNext = (): void => {
    // Stop stream so next step gets a fresh one if needed.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setStream(null)
    }
    onNext()
  }

  return (
    <StepFrame
      stepIndex={1}
      totalSteps={4}
      title="Acesso ao microfone"
      subtitle="Precisamos do seu microfone pra capturar sua voz."
      primaryLabel="Próximo"
      primaryDisabled={permission !== 'granted'}
      onPrimary={handleNext}
      onBack={onBack}
      onSkip={onSkip}
      testId="onboarding-step-mic"
    >
      <div className="space-y-5">
        <div className="flex justify-center">
          <MicIllustration size={108} />
        </div>

        {permission === 'idle' ? (
          <div className="flex justify-center">
            <Button
              variant="accent-soft"
              size="md"
              onClick={() => void requestMic()}
              className="px-6"
            >
              Permitir acesso ao microfone
            </Button>
          </div>
        ) : null}

        {permission === 'requesting' ? (
          <div
            className="flex items-center justify-center gap-2 text-xs text-text-muted"
            role="status"
          >
            <span
              aria-hidden
              className="w-3 h-3 rounded-full border-2 border-accent border-r-transparent animate-spin"
            />
            <span>solicitando permissão…</span>
          </div>
        ) : null}

        {permission === 'granted' ? (
          <Card className="p-4 border-accent/30">
            <div className="text-[10px] uppercase tracking-wider text-text-faint font-mono mb-2">
              dispositivo
            </div>
            <select
              value={selectedId}
              onChange={(e) => onDeviceChange(e.target.value)}
              aria-label="Dispositivo de microfone"
              className="w-full h-9 bg-bg-2 border border-border rounded-md text-xs text-text-primary px-3 focus:outline-none focus:border-accent/60 mb-3"
            >
              <option value="default">Padrão do sistema</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
            <div className="text-[10px] uppercase tracking-wider text-text-faint font-mono mb-1">
              nível de entrada
            </div>
            <VolumeMeter stream={stream} />
            <p className="text-[10px] text-text-muted mt-2 leading-relaxed">
              Fale qualquer coisa pra ver as barras reagirem. Se ficar tudo apagado,
              tente outro dispositivo no dropdown acima.
            </p>
          </Card>
        ) : null}

        {permission === 'denied' ? (
          <Card className="p-4 border-warning/40 bg-warning/5">
            <div className="flex gap-2 items-start">
              <span aria-hidden className="text-warning text-sm leading-none mt-0.5">
                !
              </span>
              <div className="text-[11px] text-text-secondary leading-relaxed">
                <strong className="text-warning">Permissão de microfone negada.</strong>
                <ul className="mt-2 space-y-1 list-disc list-inside text-text-muted">
                  <li>
                    Windows: Configurações → Privacidade e segurança → Microfone → habilite
                    "Permitir que aplicativos da área de trabalho acessem o microfone".
                  </li>
                  <li>Depois clique em "Tentar novamente" abaixo.</li>
                </ul>
                {errorDetail ? (
                  <div className="text-[10px] text-text-faint font-mono mt-2">
                    detalhe: {errorDetail}
                  </div>
                ) : null}
                <div className="mt-3">
                  <Button variant="accent-soft" size="sm" onClick={() => void requestMic()}>
                    tentar novamente
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </StepFrame>
  )
}
