import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../shared/components/Button'
import { Input } from '../../shared/components/Input'
import { Modal } from '../../shared/components/Modal'
import { formatRelativeTime, truncate } from '../../shared/lib/format'
import { cn } from '../../shared/lib/cn'
import type { HistoryItem } from './HistoryApp'

/**
 * HistoryTimeline — lista cronológica reversa, divididos por "Hoje / Ontem /
 * antes". Cada item mostra header (relativeTime + app + window) + texto
 * (com highlight de vocab + de match search) + badge provider + ações.
 *
 * SEM mostrar slot number / #N — só "cloud" ou "local" no badge.
 */

export function HistoryTimeline({
  items,
  loading,
  highlightQuery,
  onDelete,
  onEdit,
  onLoadMore,
  hasMore
}: {
  items: HistoryItem[]
  loading: boolean
  highlightQuery: string
  onDelete: (id: string) => void
  onEdit: (id: string, text: string) => void
  onLoadMore: () => void
  hasMore: boolean
}): JSX.Element {
  const sentinelRef = useRef<HTMLLIElement>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMoreRef.current()
      },
      { rootMargin: '200px' }
    )
    io.observe(sentinelRef.current)
    return () => io.disconnect()
  }, [hasMore])

  const grouped = useMemo(() => groupByDay(items), [items])

  if (loading) {
    return (
      <div className="p-4 space-y-3" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 rounded-lg bg-bg-2 border border-border animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm text-text-secondary mb-2">
          Sem transcrições ainda.
        </p>
        <p className="text-[11px] text-text-muted">
          Segure <code className="px-1.5 py-0.5 rounded bg-surface text-accent font-mono text-[10px] border border-border">Right Ctrl</code> em qualquer app e fale algo.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border" role="list">
      {grouped.map((group) => (
        <li key={group.label} className="contents">
          <div className="px-4 py-2 bg-bg-0 text-[10px] font-mono text-text-faint uppercase tracking-wider">
            ─── {group.label} ───
          </div>
          {group.items.map((item) => (
            <Row
              key={item.id}
              item={item}
              highlightQuery={highlightQuery}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </li>
      ))}
      {hasMore ? (
        <li ref={sentinelRef} className="h-12 flex items-center justify-center text-[10px] text-text-faint">
          carregando mais…
        </li>
      ) : null}
    </ul>
  )
}

function groupByDay(items: HistoryItem[]): { label: string; items: HistoryItem[] }[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yest = new Date(today.getTime() - 86_400_000)

  const groups: Record<string, HistoryItem[]> = {}
  const orderedKeys: string[] = []
  for (const it of items) {
    const d = new Date(it.created_at)
    d.setHours(0, 0, 0, 0)
    let label: string
    if (d.getTime() === today.getTime()) label = 'hoje'
    else if (d.getTime() === yest.getTime()) label = 'ontem'
    else
      label = new Date(it.created_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long'
      })
    if (!groups[label]) {
      groups[label] = []
      orderedKeys.push(label)
    }
    groups[label].push(it)
  }
  return orderedKeys.map((k) => ({ label: k, items: groups[k] }))
}

function Row({
  item,
  highlightQuery,
  onDelete,
  onEdit
}: {
  item: HistoryItem
  highlightQuery: string
  onDelete: (id: string) => void
  onEdit: (id: string, text: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState(item.text)

  const appIcon = useMemo(() => iconForApp(item.target_app), [item.target_app])
  const windowLabel = item.target_window ? `"${truncate(item.target_window, 36)}"` : null

  const tone =
    item.provider === 'groq' ? 'text-accent border-accent/30' : 'text-warning border-warning/30'
  const providerLabel = item.provider === 'groq' ? 'cloud' : 'local'
  const latency =
    item.latency_ms != null
      ? item.provider === 'groq'
        ? `${item.latency_ms}ms`
        : `${(item.latency_ms / 1000).toFixed(1)}s`
      : ''

  const copy = (): void => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(item.text)
    }
  }

  return (
    <article className="hist-item p-4 cursor-default hover:bg-bg-2 transition group">
      <div className="flex items-center justify-between mb-2 text-[10px] font-mono">
        <div className="flex items-center gap-2 text-text-muted">
          <span className="text-accent">{formatRelativeTime(item.created_at)}</span>
          <span className="text-text-faint">·</span>
          <span>{appIcon} {item.target_app ?? 'sem app'}</span>
          {windowLabel ? (
            <>
              <span className="text-text-faint">·</span>
              <span className="text-text-faint">{windowLabel}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {item.vocab_corrections_applied?.length ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-bg-2 border border-accent/30 text-accent font-medium inline-flex items-center gap-1">
              📚 {item.vocab_corrections_applied.length} vocab
            </span>
          ) : null}
          <span
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full bg-bg-2 border font-medium inline-flex items-center gap-1.5',
              tone
            )}
          >
            {providerLabel} {latency ? `· ${latency}` : ''}
          </span>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Input
            label="texto"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={4000}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onEdit(item.id, draft.trim())
                setEditing(false)
              }}
            >
              salvar
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-primary leading-relaxed">
          {renderText(item.text, item.vocab_corrections_applied ?? [], highlightQuery)}
        </p>
      )}

      <div className="mt-3 flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
        {item.duration_ms ? (
          <button
            type="button"
            className="px-2 py-1 rounded text-[10px] text-text-muted hover:bg-surface hover:text-accent flex items-center gap-1 font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Tocar áudio"
          >
            ▶ {formatDuration(item.duration_ms)}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="px-2 py-1 rounded text-[10px] text-text-muted hover:bg-surface hover:text-accent flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ✎ editar
        </button>
        <button
          type="button"
          onClick={copy}
          className="px-2 py-1 rounded text-[10px] text-text-muted hover:bg-surface hover:text-accent flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ⎘ copiar
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label="Apagar transcrição"
          className="ml-auto px-2 py-1 rounded text-[10px] text-text-faint hover:bg-surface hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          🗑
        </button>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Apagar transcrição?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              cancelar
            </Button>
            <Button
              variant="primary"
              className="bg-danger text-text-on-accent hover:bg-danger/90"
              onClick={() => {
                onDelete(item.id)
                setConfirmDelete(false)
              }}
            >
              apagar
            </Button>
          </>
        }
      >
        Vai sumir do histórico permanentemente. Continuar?
      </Modal>
    </article>
  )
}

function renderText(
  text: string,
  vocab: { from: string; to: string }[],
  query: string
): React.ReactNode {
  let parts: React.ReactNode[] = [text]

  // Mark vocab corrections (highlight amber).
  for (const v of vocab) {
    parts = parts.flatMap((p) => {
      if (typeof p !== 'string') return [p]
      const out: React.ReactNode[] = []
      const lower = p.toLowerCase()
      const needle = v.to.toLowerCase()
      let i = 0
      let idx: number
      while ((idx = lower.indexOf(needle, i)) !== -1) {
        if (idx > i) out.push(p.slice(i, idx))
        out.push(
          <mark
            key={`v-${v.to}-${idx}`}
            className="bg-accent/15 text-accent-2 px-1 rounded"
            title={`corrigido de "${v.from}"`}
          >
            {p.slice(idx, idx + v.to.length)}
          </mark>
        )
        i = idx + v.to.length
      }
      if (i < p.length) out.push(p.slice(i))
      return out
    })
  }

  // Mark search query (highlight cyan).
  if (query.trim()) {
    parts = parts.flatMap((p) => {
      if (typeof p !== 'string') return [p]
      const out: React.ReactNode[] = []
      const lower = p.toLowerCase()
      const needle = query.toLowerCase()
      let i = 0
      let idx: number
      while ((idx = lower.indexOf(needle, i)) !== -1) {
        if (idx > i) out.push(p.slice(i, idx))
        out.push(
          <mark
            key={`q-${query}-${idx}`}
            className="bg-accent/20 text-accent-2 px-0.5 rounded"
          >
            {p.slice(idx, idx + query.length)}
          </mark>
        )
        i = idx + query.length
      }
      if (i < p.length) out.push(p.slice(i))
      return out
    })
  }

  return <>{parts}</>
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `00:${String(s).padStart(2, '0')}`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${String(m).padStart(2, '0')}:${String(rs).padStart(2, '0')}`
}

function iconForApp(app?: string | null): string {
  if (!app) return '·'
  const a = app.toLowerCase()
  if (a.includes('chrome')) return '🌐'
  if (a.includes('firefox')) return '🦊'
  if (a.includes('notepad')) return '📝'
  if (a.includes('code')) return '📘'
  if (a.includes('slack')) return '💬'
  if (a.includes('teams')) return '👥'
  if (a.includes('whatsapp')) return '💬'
  if (a.includes('term') || a.includes('shell')) return '⌨'
  return '◌'
}
