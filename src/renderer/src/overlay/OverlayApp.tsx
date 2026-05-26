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
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop())
      } catch {
        // ignore
      }
      streamRef.current = null
      recorderRef.current = null
      chunksRef.current = []
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
        <StateView state={state} startedAt={capturingStartedAt} />
        {badge ? <Badge badge={badge} /> : null}
      </div>
    </div>
  )
}

function StateView({
  state,
  startedAt
}: {
  state: OverlayStatePayload
  startedAt: number
}): JSX.Element {
  switch (state.state) {
    case 'armed':
      return <ArmedPulse />
    case 'capturing':
      return <CapturingWaveform volumeRms={state.meta?.volumeRms} startedAt={startedAt} />
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
