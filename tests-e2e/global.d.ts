/**
 * Minimal type shim for the `window.flowtype` surface inside page.evaluate()
 * blocks. The real type lives in src/preload/main.ts (FlowtypeAPI); we keep
 * a loose shape here to avoid building the renderer's tsconfig into the
 * Playwright runner.
 */

declare global {
  interface Window {
    flowtype: {
      overlay: {
        getState: () => Promise<{ state: 'idle' | 'armed' | 'capturing' | 'processing' }>
        setState: (s: { state: 'idle' | 'armed' | 'capturing' | 'processing' }) => Promise<unknown>
        setPosition: (p: string) => Promise<unknown>
        setVisible: (v: boolean) => Promise<unknown>
      }
      hotkey: {
        setBinding: (a: string) => Promise<unknown>
        testCombo: () => Promise<unknown>
      }
      app: {
        quit: () => Promise<unknown>
        showMain: () => Promise<unknown>
        openSettings: () => Promise<unknown>
        openHistory: () => Promise<unknown>
        toggleMute: () => Promise<unknown>
        onboardingStatus: () => Promise<{ needsOnboarding: boolean }>
      }
      settings: {
        get: (key?: string) => Promise<unknown>
        getAll: () => Promise<Record<string, unknown>>
        set: (key: string, value: unknown) => Promise<unknown>
      }
      stt: {
        getProviderSettings: () => Promise<unknown>
        setForceLocal: (b: boolean) => Promise<unknown>
        setLanguage: (l: string | null) => Promise<unknown>
        poolSnapshot: () => Promise<unknown>
        addSlot: (p: unknown) => Promise<unknown>
        updateSlot: (p: unknown) => Promise<unknown>
        removeSlot: (s: 0 | 1 | 2) => Promise<unknown>
        testSlot: (s: 0 | 1 | 2) => Promise<unknown>
      }
      history: {
        list: (req?: unknown) => Promise<unknown>
        search: (req: unknown) => Promise<unknown>
        getById: (id: string) => Promise<unknown>
        updateText: (id: string, text: string) => Promise<unknown>
        delete: (id: string) => Promise<unknown>
        export: (req: { format: 'md' | 'json' }) => Promise<unknown>
      }
      vocab: {
        list: () => Promise<unknown>
        add: (e: unknown) => Promise<unknown>
        update: (e: unknown) => Promise<unknown>
        remove: (id: string) => Promise<unknown>
      }
    }
  }
}

export {}
