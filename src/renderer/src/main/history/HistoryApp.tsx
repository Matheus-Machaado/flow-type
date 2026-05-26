import { useCallback, useEffect, useMemo, useState } from 'react'
import { HistoryHeader } from './HistoryHeader'
import { HistoryTimeline } from './HistoryTimeline'
import { ExportMenu } from './ExportMenu'
import { useDebounce } from '../../shared/hooks/useDebounce'
import { getBridge } from '../../shared/hooks/useBridge'

/**
 * HistoryApp — renderiza dentro do main window como rota.
 * Timeline reversa + search FTS5 + filtros (data/app) + export md/json.
 *
 * Aceita `__flowtypeMock.historyList` pra screenshots de estado.
 */

export interface HistoryFilters {
  date: 'today' | '7d' | '30d' | 'all'
  app: string | null
}

export interface HistoryItem {
  id: string
  text: string
  created_at: string
  duration_ms?: number
  target_app?: string | null
  target_window?: string | null
  audio_path?: string | null
  provider: 'groq' | 'local' | string
  latency_ms?: number
  vocab_corrections_applied?: { from: string; to: string }[] | null
}

const PAGE_SIZE = 30

export function HistoryApp(): JSX.Element {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<HistoryFilters>({ date: 'all', app: null })
  const [items, setItems] = useState<HistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const bridge = getBridge()

  const debouncedQuery = useDebounce(query, 220)

  const apps = useMemo(() => {
    const seen = new Map<string, number>()
    for (const i of items) {
      const k = i.target_app || 'sem app'
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k)
  }, [items])

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      // Bridge missing → demo
      if (!bridge) {
        const mock =
          (typeof window !== 'undefined' && (window as Window).__flowtypeMock?.historyList) ||
          undefined
        const list = (mock as HistoryItem[] | undefined) ?? DEMO_HISTORY
        setItems(filterClient(list, debouncedQuery, filters))
        setTotal(list.length)
        setLoading(false)
        return
      }
      const filtersIpc = buildIpcFilters(filters)
      if (debouncedQuery.trim()) {
        const r = (await bridge.history.search({
          query: debouncedQuery,
          filters: filtersIpc,
          limit: PAGE_SIZE,
          offset: 0
        })) as { items: HistoryItem[]; total: number }
        setItems(r.items ?? [])
        setTotal(r.total ?? 0)
      } else {
        const r = (await bridge.history.list({
          limit: PAGE_SIZE,
          offset: 0,
          filters: filtersIpc
        })) as { items: HistoryItem[]; total: number }
        setItems(r.items ?? [])
        setTotal(r.total ?? 0)
      }
      setOffset(PAGE_SIZE)
    } catch {
      setError('Não foi possível carregar histórico')
    } finally {
      setLoading(false)
    }
  }, [bridge, debouncedQuery, filters])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = async (): Promise<void> => {
    if (!bridge || loading) return
    if (items.length >= total) return
    try {
      const filtersIpc = buildIpcFilters(filters)
      const r = debouncedQuery.trim()
        ? ((await bridge.history.search({
            query: debouncedQuery,
            filters: filtersIpc,
            limit: PAGE_SIZE,
            offset
          })) as { items: HistoryItem[]; total: number })
        : ((await bridge.history.list({
            limit: PAGE_SIZE,
            offset,
            filters: filtersIpc
          })) as { items: HistoryItem[]; total: number })
      setItems((prev) => [...prev, ...(r.items ?? [])])
      setOffset((o) => o + PAGE_SIZE)
    } catch {
      // ignore
    }
  }

  const onDelete = async (id: string): Promise<void> => {
    if (bridge) await bridge.history.delete(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setTotal((t) => Math.max(0, t - 1))
  }

  const onEdit = async (id: string, text: string): Promise<void> => {
    if (bridge) await bridge.history.updateText(id, text)
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, text } : i)))
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <HistoryHeader
        total={total}
        showing={items.length}
        query={query}
        onQueryChange={setQuery}
        filters={filters}
        onFiltersChange={setFilters}
        apps={apps}
        right={<ExportMenu filters={filters} query={debouncedQuery} />}
      />

      <div className="flex-1 overflow-y-auto bg-bg-0" role="region" aria-label="Lista de transcrições">
        <HistoryTimeline
          items={items}
          loading={loading && items.length === 0}
          highlightQuery={debouncedQuery}
          onDelete={(id) => void onDelete(id)}
          onEdit={(id, text) => void onEdit(id, text)}
          onLoadMore={() => void loadMore()}
          hasMore={items.length < total}
        />
        {error ? (
          <div className="px-4 py-3 text-[11px] text-danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <footer className="h-7 px-3 border-t border-border bg-bg-1 flex items-center gap-3 text-[10px] font-mono text-text-muted shrink-0">
        <span>
          {items.length} de {total} mostrados
        </span>
        <span className="text-text-faint">·</span>
        <span>K pra busca rápida</span>
      </footer>
    </div>
  )
}

function buildIpcFilters(f: HistoryFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (f.app) out.appExe = [f.app]
  if (f.date !== 'all') {
    const now = Date.now()
    const ms =
      f.date === 'today'
        ? 86_400_000
        : f.date === '7d'
          ? 7 * 86_400_000
          : 30 * 86_400_000
    out.dateFrom = new Date(now - ms).toISOString()
  }
  return out
}

function filterClient(
  list: HistoryItem[],
  query: string,
  filters: HistoryFilters
): HistoryItem[] {
  const q = query.trim().toLowerCase()
  let out = list
  if (q) out = out.filter((i) => i.text.toLowerCase().includes(q))
  if (filters.app) out = out.filter((i) => i.target_app === filters.app)
  if (filters.date !== 'all') {
    const ms =
      filters.date === 'today'
        ? 86_400_000
        : filters.date === '7d'
          ? 7 * 86_400_000
          : 30 * 86_400_000
    out = out.filter((i) => Date.now() - new Date(i.created_at).getTime() <= ms)
  }
  return out
}

// ─── Demo data pro harness sem bridge ────────────────────────────────

const DEMO_HISTORY: HistoryItem[] = [
  {
    id: '01HV-001',
    text: 'SPA mesmo, e queria stateless puro, sem tabela de sessions. Refresh token via HttpOnly cookie pode ser uma boa pra renovação silenciosa em background, com endpoint dedicado pra reunião técnica semana que vem.',
    created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    duration_ms: 4000,
    target_app: 'chrome.exe',
    target_window: 'Claude',
    provider: 'groq',
    latency_ms: 720
  },
  {
    id: '01HV-002',
    text: 'Lista de compras: pão, leite, café, queijo, manteiga, e umas frutas se sobrar tempo no mercado.',
    created_at: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
    duration_ms: 8000,
    target_app: 'notepad.exe',
    target_window: 'Sem título',
    provider: 'local',
    latency_ms: 3200
  },
  {
    id: '01HV-003',
    text: 'Cunha chegou cedo e já adiantou os tickets de bug do sprint atual.',
    created_at: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
    duration_ms: 6000,
    target_app: 'chrome.exe',
    target_window: 'Claude',
    provider: 'groq',
    latency_ms: 680,
    vocab_corrections_applied: [{ from: 'kunha', to: 'Cunha' }]
  },
  {
    id: '01HV-004',
    text: 'Adiciona prop opcional mode equals string union full pipe compact, default full.',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    duration_ms: 5000,
    target_app: 'code.exe',
    target_window: 'GroqProviderSection.tsx',
    provider: 'groq',
    latency_ms: 840
  },
  {
    id: '01HV-005',
    text: 'Vou chegar mais cedo no jantar de domingo, qualquer coisa avisa o Pedro pra ir buscar a vó.',
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    duration_ms: 7000,
    target_app: 'chrome.exe',
    target_window: 'WhatsApp Web — Família',
    provider: 'groq',
    latency_ms: 690
  },
  {
    id: '01HV-006',
    text: 'Time, deploy do Flow Type v0.1 sai sexta. Quem ainda tem PR aberto, fechar até quinta de manhã.',
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    duration_ms: 6000,
    target_app: 'slack.exe',
    target_window: '#dev',
    provider: 'groq',
    latency_ms: 710
  }
]
