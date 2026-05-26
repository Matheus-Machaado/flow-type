import { useState, useRef, useEffect } from 'react'
import { Button } from '../../shared/components/Button'
import { getBridge } from '../../shared/hooks/useBridge'
import type { HistoryFilters } from './HistoryApp'

/**
 * ExportMenu — dropdown markdown/JSON. Chama bridge.history.export e dispara
 * download local via blob URL.
 */
export function ExportMenu({
  filters,
  query: _query
}: {
  filters: HistoryFilters
  query: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const bridge = getBridge()

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent): void {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const doExport = async (format: 'md' | 'json'): Promise<void> => {
    setBusy(format)
    try {
      if (!bridge) {
        const dummy = format === 'md' ? '# Flow Type · Histórico\n\n(demo)' : '[]'
        triggerDownload(`flow-type-historico.${format === 'md' ? 'md' : 'json'}`, dummy)
        return
      }
      const filtersIpc: Record<string, unknown> = {}
      if (filters.app) filtersIpc.appExe = [filters.app]
      if (filters.date !== 'all') {
        const ms =
          filters.date === 'today'
            ? 86_400_000
            : filters.date === '7d'
              ? 7 * 86_400_000
              : 30 * 86_400_000
        filtersIpc.dateFrom = new Date(Date.now() - ms).toISOString()
      }
      const r = (await bridge.history.export({
        format,
        filters: filtersIpc as never
      })) as { content: string; filename: string }
      triggerDownload(r.filename, r.content)
    } catch {
      // ignore
    } finally {
      setBusy(null)
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        exportar ▾
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 bg-surface border border-border-strong rounded-lg shadow-overlay py-1 z-20"
        >
          <MenuItem onClick={() => void doExport('md')} busy={busy === 'md'}>
            como markdown
          </MenuItem>
          <MenuItem onClick={() => void doExport('json')} busy={busy === 'json'}>
            como JSON
          </MenuItem>
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({
  onClick,
  busy,
  children
}: {
  onClick: () => void
  busy?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={busy}
      className="block w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-2 hover:text-accent disabled:opacity-60 focus:outline-none focus-visible:bg-bg-2"
    >
      {busy ? 'exportando…' : children}
    </button>
  )
}

function triggerDownload(filename: string, content: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
