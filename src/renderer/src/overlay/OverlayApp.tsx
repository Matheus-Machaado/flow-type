import { useEffect, useState, useMemo } from 'react'
import type { OverlayStatePayload, OverlayBadgePayload } from '@shared/ipc-types'
import { IdleDot } from './states/IdleDot'
import { ArmedPulse } from './states/ArmedPulse'
import { CapturingWaveform } from './states/CapturingWaveform'
import { ProcessingSpinner } from './states/ProcessingSpinner'

/**
 * The overlay window root. Subscribes to overlay state via the preload
 * bridge (`window.flowtypeOverlay`), and renders the matching state component.
 *
 * Falls back to a query-string state for isolated browser testing
 * (`overlay.html?state=armed` etc), which the screenshot harness uses.
 */
export function OverlayApp(): JSX.Element {
  const [state, setState] = useState<OverlayStatePayload>({ state: 'idle' })
  const [badge, setBadge] = useState<OverlayBadgePayload | null>(null)
  const [hover, setHover] = useState(false)
  const [capturingStartedAt, setCapturingStartedAt] = useState<number>(Date.now())

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
    // Real subscription path (Electron). `flowtypeOverlay` is the preload bridge.
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

    return () => {
      unsubState?.()
      unsubBadge?.()
      unsubEnter?.()
      unsubLeave?.()
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
      <div className="relative w-full h-full rounded-[12px] bg-bg-1/85 backdrop-blur-sm border border-border-strong shadow-overlay flex items-center px-3">
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
      className="absolute -bottom-6 right-0 text-[10px] font-mono text-accent bg-bg-1/90 border border-border px-1.5 py-0.5 rounded-md shadow-overlay animate-badge-in"
      role="status"
    >
      {kindLabel} · {badge.latencyMs}ms
    </span>
  )
}
