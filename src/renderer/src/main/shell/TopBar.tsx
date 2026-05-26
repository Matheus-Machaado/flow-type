import { cn } from '../../shared/lib/cn'
import { FlowTypeMark } from './FlowTypeMark'
import { APP_VERSION_TAG } from '../../shared/lib/app-version'
import type { RouteId } from '../App'

/**
 * TopBar — barra fixa no topo da main window com brand "Flow Type" +
 * navegação entre Home, Settings, Histórico. Sem react-router; só state local.
 */
export function TopBar({
  route,
  onNavigate
}: {
  route: RouteId
  onNavigate: (to: RouteId) => void
}): JSX.Element {
  return (
    <header
      role="banner"
      className="h-12 px-4 flex items-center justify-between border-b border-border bg-bg-1 shrink-0"
    >
      <button
        type="button"
        onClick={() => onNavigate('home')}
        className="flex items-center gap-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md px-1 py-1 -mx-1"
        aria-label="Flow Type — voltar pro início"
      >
        <FlowTypeMark />
        <span className="text-sm font-semibold tracking-tight text-text-primary group-hover:text-accent transition-colors">
          Flow Type
        </span>
        <span className="text-[10px] font-mono text-text-faint ml-1">{APP_VERSION_TAG}</span>
      </button>

      <nav aria-label="Main navigation" className="flex items-center gap-1">
        <NavLink active={route === 'home'} onClick={() => onNavigate('home')}>
          Início
        </NavLink>
        <NavLink active={route === 'settings'} onClick={() => onNavigate('settings')}>
          Configurações
        </NavLink>
        <NavLink active={route === 'history'} onClick={() => onNavigate('history')}>
          Histórico
        </NavLink>
      </nav>
    </header>
  )
}

function NavLink({
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
      aria-current={active ? 'page' : undefined}
      className={cn(
        'h-8 px-3 rounded-md text-xs font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active
          ? 'bg-accent/10 text-accent border border-accent/30'
          : 'text-text-muted hover:text-text-primary hover:bg-bg-2 border border-transparent'
      )}
    >
      {children}
    </button>
  )
}
