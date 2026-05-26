/**
 * Helpers de formatação reusados em Settings/Histórico.
 */

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const ts = new Date(iso).getTime()
  const diffSec = Math.max(0, Math.floor((now.getTime() - ts) / 1000))
  if (diffSec < 5) return 'agora'
  if (diffSec < 60) return `há ${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `há ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today.getTime() - 86_400_000)
  const tsDay = new Date(ts)
  tsDay.setHours(0, 0, 0, 0)
  if (tsDay.getTime() === yesterday.getTime()) {
    return `ontem ${new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  }
  const diffDays = Math.floor(diffSec / 86_400)
  if (diffDays < 7) return `há ${diffDays}d`
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function truncate(s: string, max: number): string {
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)) + '…'
}

export function maskApiKey(key: string | null | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return 'gsk_•••••'
  const tail = key.slice(-4)
  return `gsk_•••••${tail}`
}

export function formatNumber(n: number): string {
  if (n >= 1000) {
    const k = (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)
    return `${k}k`
  }
  return String(n)
}

export function pctOf(used: number, cap: number): number {
  if (!cap || cap <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((used / cap) * 100)))
}
