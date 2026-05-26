import { cn } from '../../shared/lib/cn'
import { Icon } from '../../shared/components/icons/Icon'
import type { HistoryFilters } from './HistoryApp'

/**
 * HistoryHeader — search bar topo + filtros chips (data + app).
 * Empty `apps` é ok (chips só de data aparecem).
 */
export function HistoryHeader({
  total,
  showing: _showing,
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  apps,
  right
}: {
  total: number
  showing: number
  query: string
  onQueryChange: (q: string) => void
  filters: HistoryFilters
  onFiltersChange: (f: HistoryFilters) => void
  apps: string[]
  right?: React.ReactNode
}): JSX.Element {
  const setDate = (date: HistoryFilters['date']): void =>
    onFiltersChange({ ...filters, date })
  const setApp = (app: string | null): void =>
    onFiltersChange({ ...filters, app })

  return (
    <div className="p-4 border-b border-border bg-bg-1 shrink-0 space-y-3">
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <span
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          >
            <Icon name="search" size={14} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="buscar nas transcrições…"
            aria-label="Buscar no histórico"
            className="w-full h-9 pl-9 pr-9 rounded-lg bg-bg-2 border border-border text-sm text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 focus:bg-surface transition"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary w-6 h-6 rounded-full hover:bg-surface flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
        {right}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-text-faint font-mono uppercase tracking-wider">
          data
        </span>
        <Chip active={filters.date === 'today'} onClick={() => setDate('today')}>
          Hoje
        </Chip>
        <Chip active={filters.date === '7d'} onClick={() => setDate('7d')}>
          7 dias
        </Chip>
        <Chip active={filters.date === '30d'} onClick={() => setDate('30d')}>
          30 dias
        </Chip>
        <Chip active={filters.date === 'all'} onClick={() => setDate('all')}>
          Tudo
        </Chip>

        {apps.length > 0 ? (
          <>
            <div className="w-px h-4 bg-border mx-1" aria-hidden />
            <span className="text-[10px] text-text-faint font-mono uppercase tracking-wider">
              app
            </span>
            <Chip active={filters.app === null} onClick={() => setApp(null)}>
              Todos
            </Chip>
            {apps.map((a) => (
              <Chip key={a} active={filters.app === a} onClick={() => setApp(a)}>
                {prettyAppName(a)}
              </Chip>
            ))}
          </>
        ) : null}

        <span className="ml-auto text-[10px] text-text-muted font-mono">
          {total} {total === 1 ? 'transcrição' : 'transcrições'}
        </span>
      </div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'px-2.5 py-1 rounded-full text-[10px] border transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active
          ? 'bg-accent text-text-on-accent font-semibold border-accent'
          : 'bg-bg-2 text-text-muted hover:text-text-primary border-border'
      )}
    >
      {children}
    </button>
  )
}

/**
 * Formata exe name → label amigável.
 * 'chrome.exe' → 'Chrome'; 'Code.exe' → 'Code'; 'whatsapp.exe' → 'WhatsApp'.
 */
function prettyAppName(exe: string): string {
  const base = exe.replace(/\.exe$/i, '').replace(/[._-]+/g, ' ').trim()
  if (!base) return exe
  // Casos especiais com capitalização própria.
  const lower = base.toLowerCase()
  const SPECIAL: Record<string, string> = {
    whatsapp: 'WhatsApp',
    chatgpt: 'ChatGPT',
    vscode: 'VS Code',
    'visual studio code': 'VS Code',
    'powerpoint': 'PowerPoint',
    'msteams': 'Teams'
  }
  if (SPECIAL[lower]) return SPECIAL[lower]
  // Default: title-case (primeira letra de cada palavra).
  return base
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}
