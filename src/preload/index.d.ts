import type { FlowtypeAPI } from './main'
import type { FlowtypeOverlayAPI } from './overlay'

declare global {
  interface Window {
    flowtype: FlowtypeAPI
    flowtypeOverlay: FlowtypeOverlayAPI
  }
}

export {}
