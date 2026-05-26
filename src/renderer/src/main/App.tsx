import { useEffect, useState, useMemo } from 'react'
import { SettingsApp } from './settings/SettingsApp'
import { HistoryApp } from './history/HistoryApp'
import { HomeView } from './home/HomeView'
import { TopBar } from './shell/TopBar'
import { OnboardingApp } from './onboarding/OnboardingApp'
import { getBridge } from '../shared/hooks/useBridge'

/**
 * MainApp — root da main window.
 *
 * Renderiza:
 *  - <OnboardingApp /> em fullscreen quando `settings.first_run_completed === false`
 *    (wizard 4 passos, sem TopBar).
 *  - Caso contrário, roteamento state-local entre `home`, `settings`, `history`
 *    via query string (?view=settings|history).
 *
 * Onboarding decision:
 *  - Bridge presente: bridge.app.onboardingStatus() (preferido) ou
 *    bridge.settings.get('first_run_completed') (fallback). Carrega antes de
 *    decidir; mostra splash mínimo enquanto resolve.
 *  - Bridge ausente (audit/screenshot harness): respeita
 *    `window.__flowtypeMock.forceOnboarding` (true → mostra wizard).
 *
 * Brand visível: "Flow Type" (duas palavras, capitalized) por toda UI.
 * Slug técnico continua "flowtype" (pasta, npm).
 */

export type RouteId = 'home' | 'settings' | 'history'

/**
 * Local view of `window.__flowtypeMock` augmented with onboarding flags.
 * GroqProviderSection já declara o tipo base; aqui só ampliamos via cast
 * pra evitar conflict de "Subsequent property declarations".
 */
type MockWithOnboarding = {
  forceOnboarding?: boolean
  onboardingInitialStep?: 0 | 1 | 2 | 3
}

export function MainApp(): JSX.Element {
  const initial = useMemo<RouteId>(() => {
    if (typeof window === 'undefined') return 'home'
    const p = new URLSearchParams(window.location.search).get('view')
    if (p === 'settings' || p === 'history') return p
    return 'home'
  }, [])

  const [route, setRoute] = useState<RouteId>(initial)
  // null = still resolving; true = needs onboarding; false = done
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null)
  const bridge = getBridge()

  // Resolve onboarding state on mount.
  useEffect(() => {
    let cancelled = false

    // Audit harness override: ?view=onboarding OR mock.forceOnboarding=true.
    if (typeof window !== 'undefined') {
      const urlView = new URLSearchParams(window.location.search).get('view')
      if (urlView === 'onboarding') {
        setNeedsOnboarding(true)
        return
      }
      const mock = window.__flowtypeMock as (typeof window.__flowtypeMock & MockWithOnboarding) | undefined
      if (!bridge && mock?.forceOnboarding) {
        setNeedsOnboarding(true)
        return
      }
    }

    if (!bridge) {
      // Demo/harness without explicit override → assume done.
      setNeedsOnboarding(false)
      return
    }

    void (async () => {
      try {
        const status = (await bridge.app.onboardingStatus()) as
          | { needsOnboarding?: boolean; completed?: boolean }
          | null
        if (cancelled) return
        if (status && typeof status.needsOnboarding === 'boolean') {
          setNeedsOnboarding(status.needsOnboarding)
          return
        }
        if (status && typeof status.completed === 'boolean') {
          setNeedsOnboarding(!status.completed)
          return
        }
        // Fallback: read flag directly.
        const flag = (await bridge.settings.get('first_run_completed')) as boolean | undefined
        setNeedsOnboarding(!flag)
      } catch {
        if (!cancelled) setNeedsOnboarding(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bridge])

  // Listen for tray-driven navigation (main process pushes view changes).
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onPop(): void {
      const p = new URLSearchParams(window.location.search).get('view')
      if (p === 'settings' || p === 'history') setRoute(p)
      else setRoute('home')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = (to: RouteId): void => {
    setRoute(to)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (to === 'home') url.searchParams.delete('view')
      else url.searchParams.set('view', to)
      window.history.pushState({}, '', url.toString())
    }
  }

  const completeOnboarding = (): void => {
    setNeedsOnboarding(false)
    // Send to home regardless of current ?view.
    setRoute('home')
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('view')
      window.history.replaceState({}, '', url.toString())
    }
  }

  // Splash mínimo enquanto resolve onboarding (não bloqueia screenshot).
  if (needsOnboarding === null) {
    return (
      <div className="min-h-screen w-full bg-bg-0 flex items-center justify-center">
        <div
          aria-hidden
          className="w-6 h-6 rounded-full border-2 border-accent border-r-transparent animate-spin"
        />
      </div>
    )
  }

  if (needsOnboarding) {
    return <OnboardingApp onComplete={completeOnboarding} />
  }

  return (
    <div className="min-h-screen bg-bg-0 text-text-primary font-sans flex flex-col">
      <TopBar route={route} onNavigate={go} />
      <div className="flex-1 min-h-0 flex">
        {route === 'home' ? <HomeView onNavigate={go} /> : null}
        {route === 'settings' ? <SettingsApp /> : null}
        {route === 'history' ? <HistoryApp /> : null}
      </div>
    </div>
  )
}
