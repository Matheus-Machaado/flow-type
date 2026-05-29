import { useEffect, useState, useMemo, useRef } from 'react'
import type { OverlayStatePayload, OverlayBadgePayload } from '@shared/ipc-types'
import { IdleDot } from './states/IdleDot'
import { ArmedPulse } from './states/ArmedPulse'
import { CapturingWaveform } from './states/CapturingWaveform'
import { ProcessingSpinner } from './states/ProcessingSpinner'

// Cap fixo de gravação (CR F-001). Acima disso o overlay para sozinho:
// em push-to-talk para o MediaRecorder; em LOCK chama requestForceUnlock
// pra main, que emite onReleased pelo caminho normal (mantém pipeline).
const RECORDING_MAX_MS = 60_000
// Cor da barra muda pra warning quando faltam ≤ este tempo.
const CAP_WARN_MS = 10_000

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
  // CR F-002: locked = entered LOCK via double-tap (overlay shows badge).
  const [isLocked, setIsLocked] = useState(false)
  // CR F-001: tick triggers re-render so the progress bar updates smoothly.
  const [, setProgressTick] = useState(0)

  // MediaRecorder + stream refs survive renders.
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordStartedAtRef = useRef<number>(0)
  // CR F-001: cap timer + tick interval for progress bar.
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isLockedRef = useRef(false)

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

        // CR F-001: arm the recording cap. Whoever stops first wins
        // (user release / overlay cap timer / forced unlock from main).
        if (capTimerRef.current) clearTimeout(capTimerRef.current)
        capTimerRef.current = setTimeout(() => {
          handleCapHit()
        }, RECORDING_MAX_MS)
        if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
        tickIntervalRef.current = setInterval(() => {
          setProgressTick((n) => (n + 1) % 1_000_000)
        }, 200)

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
      if (capTimerRef.current) {
        clearTimeout(capTimerRef.current)
        capTimerRef.current = null
      }
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current)
        tickIntervalRef.current = null
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

    /**
     * CR F-001: recording cap reached. If we're in LOCK, ask main to leave
     * LOCK (it emits `hotkey:released` through the regular channel, which
     * routes us back into stopRecording above). If we're in plain
     * push-to-talk we just stop locally; main will see the audio buffer
     * arrive and broadcast the processing transition itself.
     */
    const handleCapHit = (): void => {
      if (!recorderRef.current) return
      if (isLockedRef.current) {
        try {
          bridge.requestForceUnlock({ reason: 'recording-cap' })
        } catch (err) {
          console.warn('[overlay] requestForceUnlock failed; stopping locally', err)
          void stopRecording()
        }
        return
      }
      // Push-to-talk: stop locally regardless of whether the user is still
      // pressing the key. The held key staying down has no further effect
      // because handleUp on main will see armedFired=true → emit released.
      void stopRecording()
    }

    const unsubArmed = bridge.onHotkeyArmed?.(() => {
      void startRecording()
    })
    const unsubReleased = bridge.onHotkeyReleased?.(() => {
      void stopRecording()
    })
    const unsubLock = bridge.onHotkeyLockChanged?.((p) => {
      isLockedRef.current = p.locked
      setIsLocked(p.locked)
    })

    return () => {
      unsubState?.()
      unsubBadge?.()
      unsubEnter?.()
      unsubLeave?.()
      unsubArmed?.()
      unsubReleased?.()
      unsubLock?.()
      cleanupRecording()
    }
  }, [queryState])

  // Idle opacity drops to 0.45 unless hovering (hot-corner reveal).
  const isIdle = state.state === 'idle'
  const idleOpacity = hover ? 1 : 0.45
  const opacity = isIdle ? idleOpacity : 1
  // CR F-001: progress bar visible while we have a cap timer running.
  const showCap = state.state === 'capturing' && recordStartedAtRef.current > 0
  const elapsedMs = showCap ? Math.max(0, Date.now() - recordStartedAtRef.current) : 0
  const capProgress = Math.min(1, elapsedMs / RECORDING_MAX_MS)
  const capWarning = RECORDING_MAX_MS - elapsedMs <= CAP_WARN_MS

  return (
    <div
      className="overlay-root flex items-center justify-start p-3 transition-opacity duration-200"
      style={{ opacity }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative w-full h-full rounded-[12px] bg-bg-1/85 backdrop-blur-sm border border-border-strong flex items-center px-3 overflow-hidden">
        {/* Drag handle (top half is draggable; bottom half ignores so clicks/hover still work). */}
        <div
          className="overlay-drag-handle absolute top-0 left-0 right-0 h-1/2 pointer-events-auto"
          aria-hidden="true"
        />
        <StateView state={state} startedAt={capturingStartedAt} liveRms={volumeRms} />
        {isLocked && state.state === 'capturing' ? <LockChip /> : null}
        {badge ? <Badge badge={badge} /> : null}
        {showCap ? <CapProgressBar progress={capProgress} warning={capWarning} /> : null}
      </div>
    </div>
  )
}

function LockChip(): JSX.Element {
  return (
    <span
      className="absolute top-1 right-1.5 text-[9px] font-mono uppercase tracking-wider text-accent bg-accent/10 border border-accent/30 px-1.5 py-[1px] rounded-sm"
      role="status"
      aria-label="Gravação travada. Toque na hotkey para parar."
      title="LOCK ativo — toque na hotkey pra parar"
    >
      lock
    </span>
  )
}

function CapProgressBar({ progress, warning }: { progress: number; warning: boolean }): JSX.Element {
  const widthPct = (progress * 100).toFixed(1)
  const color = warning ? 'bg-warning' : 'bg-accent/70'
  return (
    <div
      className="absolute bottom-0 left-0 right-0 h-[2px] bg-border/40"
      aria-hidden="true"
    >
      <div
        className={`${color} h-full transition-[width] duration-200 ease-linear`}
        style={{ width: `${widthPct}%` }}
      />
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
