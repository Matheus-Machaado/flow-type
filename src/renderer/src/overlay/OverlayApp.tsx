import { useEffect, useState, useMemo, useRef } from 'react'
import type { OverlayStatePayload, OverlayBadgePayload } from '@shared/ipc-types'
import { IdleDot } from './states/IdleDot'
import { ArmedPulse } from './states/ArmedPulse'
import { CapturingWaveform } from './states/CapturingWaveform'
import { ProcessingSpinner } from './states/ProcessingSpinner'

/**
 * The overlay window root. v0.1.1 — orchestrates the full pipeline:
 *  1. hotkey:armed → starts MediaRecorder (mic capture).
 *  2. (UI flips to "capturing" with live waveform).
 *  3. hotkey:released → stops recorder, sends audio buffer to main.
 *  4. Main runs STT cascade → vocab → paste → history; broadcasts overlay
 *     state transitions throughout (processing → idle) plus a badge.
 *
 * Query-string override (`overlay.html?state=armed` etc) is preserved for
 * isolated browser testing.
 */
export function OverlayApp(): JSX.Element {
  const [state, setState] = useState<OverlayStatePayload>({ state: 'idle' })
  const [badge, setBadge] = useState<OverlayBadgePayload | null>(null)
  const [hover, setHover] = useState(false)
  const [capturingStartedAt, setCapturingStartedAt] = useState<number>(Date.now())

  // MediaRecorder + stream refs survive renders.
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordStartedAtRef = useRef<number>(0)

  // Live mic level (0..1). Drives CapturingWaveform — não há fallback fake.
  // Quando o mic está mudo/desconectado, fica em 0 e a waveform achata,
  // permitindo o usuário identificar que algo está errado.
  const [volumeRms, setVolumeRms] = useState<number>(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rmsRafRef = useRef<number | null>(null)

  // Query-string override for isolated testing (no Electron required).
  const queryState = useMemo<OverlayStatePayload['state'] | null>(() => {
    if (typeof window === 'undefined') return null
    const p = new URLSearchParams(window.location.search)
    const s = p.get('state')
    if (s === 'idle' || s === 'armed' || s === 'capturing' || s === 'processing') return s
    return null
  }, [])

  useEffect(() => {
    if (queryState) {
      setState({ state: queryState })
      if (queryState === 'capturing') setCapturingStartedAt(Date.now())
      return
    }
    const bridge = (window as { flowtypeOverlay?: Window['flowtypeOverlay'] }).flowtypeOverlay
    if (!bridge) return

    void bridge.getState().then((s) => setState(s))

    const unsubState = bridge.onSetState((s) => {
      setState((prev) => {
        if (s.state === 'capturing' && prev.state !== 'capturing') {
          setCapturingStartedAt(Date.now())
        }
        return s
      })
    })

    const unsubBadge = bridge.onBadge((b) => {
      setBadge(b)
      setTimeout(() => setBadge(null), b.ttlMs)
    })

    const unsubEnter = bridge.onHotCornerEnter(() => setHover(true))
    const unsubLeave = bridge.onHotCornerLeave(() => setHover(false))

    // ── Audio capture pipeline ────────────────────────────────────────────
    const startRecording = async (): Promise<void> => {
      try {
        if (recorderRef.current) {
          // Already recording (defensive — duplicate armed event).
          return
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'
        const recorder = new MediaRecorder(stream, { mimeType: mime })
        chunksRef.current = []
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
        }
        recorder.start(100) // emit chunks every 100ms; covers short holds
        recorderRef.current = recorder
        recordStartedAtRef.current = Date.now()

        // Real mic-level meter: AnalyserNode reads PCM directly from the
        // MediaStream and computes RMS per frame. Drives the waveform UI.
        try {
          // Lazy-create AudioContext on first interaction (autoplay-safe).
          if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            const Ctor =
              (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
                .AudioContext ??
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            audioCtxRef.current = new Ctor()
          }
          if (audioCtxRef.current.state === 'suspended') {
            await audioCtxRef.current.resume()
          }
          const source = audioCtxRef.current.createMediaStreamSource(stream)
          sourceRef.current = source
          const analyser = audioCtxRef.current.createAnalyser()
          analyser.fftSize = 512
          analyser.smoothingTimeConstant = 0.4
          source.connect(analyser)
          analyserRef.current = analyser

          const data = new Uint8Array(analyser.fftSize)
          const tick = (): void => {
            if (!analyserRef.current) return
            analyserRef.current.getByteTimeDomainData(data)
            // RMS of the signal (deviation from 128 = silence midpoint).
            let sumSq = 0
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128 // -1..1
              sumSq += v * v
            }
            const rms = Math.sqrt(sumSq / data.length) // 0..1 typically peaks ~0.3 for normal voice
            // Boost so normal voice fills the bars; clamp 0..1.
            const normalized = Math.min(1, rms * 3.2)
            setVolumeRms(normalized)
            rmsRafRef.current = requestAnimationFrame(tick)
          }
          rmsRafRef.current = requestAnimationFrame(tick)
        } catch (err) {
          console.warn('[overlay] RMS meter init failed (non-fatal)', err)
        }

        // Local visual transition to capturing as soon as we're actually recording.
        setState({ state: 'capturing' })
        setCapturingStartedAt(Date.now())
      } catch (err) {
        console.error('[overlay] startRecording failed', err)
        cleanupRecording()
        setState({ state: 'idle' })
      }
    }

    const stopRecording = async (): Promise<void> => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        cleanupRecording()
        return
      }
      // Local visual: bump to processing right away.
      setState({ state: 'processing', meta: { label: 'transcrevendo…' } })
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
      try {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const durationMs = Date.now() - recordStartedAtRef.current
        cleanupRecording()
        if (blob.size < 1024) {
          // Hold too short — likely accidental tap.
          setState({ state: 'idle' })
          return
        }
        const buffer = await blob.arrayBuffer()
        const result = await bridge.transcribeAndInject(buffer, durationMs)
        if (!result.ok) {
          console.warn('[overlay] transcribeAndInject failed:', result.error)
        }
        // Main broadcasts the final 'idle' state via onTranscribed hook.
        // If the call somehow returns without main broadcasting (degraded
        // backend stub), fall back to idle locally after a beat.
        setTimeout(() => {
          if (recorderRef.current === null) {
            setState((prev) => (prev.state === 'processing' ? { state: 'idle' } : prev))
          }
        }, 1500)
      } catch (err) {
        console.error('[overlay] sending audio failed', err)
        cleanupRecording()
        setState({ state: 'idle' })
      }
    }

    const cleanupRecording = (): void => {
      if (rmsRafRef.current != null) {
        cancelAnimationFrame(rmsRafRef.current)
        rmsRafRef.current = null
      }
      try {
        sourceRef.current?.disconnect()
      } catch {
        // ignore
      }
      sourceRef.current = null
      analyserRef.current = null
      // AudioContext fica vivo entre gravações (reuso é OK). Só limpa stream.
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop())
      } catch {
        // ignore
      }
      streamRef.current = null
      recorderRef.current = null
      chunksRef.current = []
      setVolumeRms(0)
    }

    const unsubArmed = bridge.onHotkeyArmed?.(() => {
      void startRecording()
    })
    const unsubReleased = bridge.onHotkeyReleased?.(() => {
      void stopRecording()
    })

    return () => {
      unsubState?.()
      unsubBadge?.()
      unsubEnter?.()
      unsubLeave?.()
      unsubArmed?.()
      unsubReleased?.()
      cleanupRecording()
    }
  }, [queryState])

  // Idle opacity drops to 0.45 unless hovering (hot-corner reveal).
  const isIdle = state.state === 'idle'
  const idleOpacity = hover ? 1 : 0.45
  const opacity = isIdle ? idleOpacity : 1

  return (
    <div
      className="overlay-root flex items-center justify-start p-3 transition-opacity duration-200"
      style={{ opacity }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative w-full h-full rounded-[12px] bg-bg-1/85 backdrop-blur-sm border border-border-strong flex items-center px-3">
        {/* Drag handle (top half is draggable; bottom half ignores so clicks/hover still work). */}
        <div
          className="overlay-drag-handle absolute top-0 left-0 right-0 h-1/2 pointer-events-auto"
          aria-hidden="true"
        />
        <StateView state={state} startedAt={capturingStartedAt} liveRms={volumeRms} />
        {badge ? <Badge badge={badge} /> : null}
      </div>
    </div>
  )
}

function StateView({
  state,
  startedAt,
  liveRms
}: {
  state: OverlayStatePayload
  startedAt: number
  liveRms: number
}): JSX.Element {
  switch (state.state) {
    case 'armed':
      return <ArmedPulse />
    case 'capturing':
      // liveRms = nível real do mic (0..1). Sem fallback fake — se está 0,
      // a waveform achata e o usuário vê que o mic não está captando.
      return <CapturingWaveform volumeRms={liveRms} startedAt={startedAt} />
    case 'processing':
      return <ProcessingSpinner label={state.meta?.label} />
    case 'idle':
    default:
      return <IdleDot />
  }
}

function Badge({ badge }: { badge: OverlayBadgePayload }): JSX.Element {
  // CR-2: nunca expor slotIndex / "#N" no badge — só cloud (Groq) ou local.
  const kindLabel = badge.kind === 'groq' ? 'Groq' : 'local'
  return (
    <span
      className="absolute -bottom-6 right-0 text-[10px] font-mono text-accent bg-bg-1/90 border border-border px-1.5 py-0.5 rounded-md animate-badge-in"
      role="status"
    >
      {kindLabel} · {badge.latencyMs}ms
    </span>
  )
}
