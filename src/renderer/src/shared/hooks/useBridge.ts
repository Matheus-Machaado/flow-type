/**
 * Lightweight access to the preload bridges.
 *
 * `window.flowtype` é exposto pelo `src/preload/main.ts`. Quando rodando
 * via Playwright headless contra o renderer buildado (sem Electron),
 * o bridge não existe — esses helpers retornam `null` e os componentes
 * caem em modo "demo" controlado (mock state local). Garante que a
 * auditoria visual não quebre por erro de bridge.
 */

type Flowtype = Window['flowtype']

export function getBridge(): Flowtype | null {
  if (typeof window === 'undefined') return null
  return (window as { flowtype?: Flowtype }).flowtype ?? null
}

export function hasBridge(): boolean {
  return getBridge() !== null
}
