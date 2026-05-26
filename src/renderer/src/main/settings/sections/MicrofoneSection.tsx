import { useEffect, useState } from 'react'
import { Button } from '../../../shared/components/Button'
import { cn } from '../../../shared/lib/cn'

/**
 * MicrofoneSection — dropdown de devices + teste com volume meter em tempo real.
 */
export function MicrofoneSection(): JSX.Element {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedId, setSelectedId] = useState<string>('default')
  const [level, setLevel] = useState<number>(0)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => setDevices([]))
  }, [])

  const startTest = async (): Promise<void> => {
    if (testing) return
    if (!navigator?.mediaDevices) return
    setTesting(true)
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedId === 'default' ? true : { deviceId: { exact: selectedId } }
      })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      src.connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const started = Date.now()
      const tick = (): void => {
        if (Date.now() - started > 4000) {
          stream.getTracks().forEach((t) => t.stop())
          void ctx.close()
          setLevel(0)
          setTesting(false)
          return
        }
        analyser.getByteFrequencyData(buf)
        const sum = buf.reduce((a, b) => a + b, 0)
        const avg = sum / buf.length / 255
        setLevel(avg)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    } catch {
      setError('Não foi possível acessar o microfone.')
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3">
      <Row label="Dispositivo" hint="Microfone usado pra captura quando a hotkey está armada.">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="h-9 bg-bg-2 border border-border rounded-md text-xs text-text-primary px-3 focus:outline-none focus:border-accent/60"
          aria-label="Dispositivo de captura"
        >
          <option value="default">Padrão do sistema</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Testar nível" hint="Grava 4s pra mostrar o volume captado.">
        <Button variant="accent-soft" onClick={startTest} disabled={testing}>
          {testing ? 'gravando 4s…' : 'gravar 4s'}
        </Button>
      </Row>
      <div className="flex items-end gap-[3px] h-8 px-2" aria-label="Volume meter">
        {Array.from({ length: 24 }).map((_, i) => {
          const active = level * 24 > i
          return (
            <span
              key={i}
              className={cn(
                'w-1.5 rounded-sm transition-all',
                active ? 'bg-accent shadow-glow' : 'bg-bg-2 border border-border'
              )}
              style={{ height: `${Math.max(6, (i + 1) * 1.2)}px` }}
            />
          )
        })}
      </div>
      {error ? (
        <p className="text-[10px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0 gap-4">
      <div>
        <div className="text-xs text-text-secondary">{label}</div>
        {hint ? <div className="text-[10px] text-text-muted mt-0.5">{hint}</div> : null}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
