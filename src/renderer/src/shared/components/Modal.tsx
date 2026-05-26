import { useEffect, useRef } from 'react'
import { cn } from '../lib/cn'

/**
 * Modal — confirm modal inline (cobra a lição feedback_modal_close_drag_guard:
 * só fecha se mousedown começou no backdrop, NÃO se foi arrasto dentro do
 * conteúdo soltando fora). Usa Escape pra fechar; trap focus simples.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 360
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}): JSX.Element | null {
  const backdropRef = useRef<HTMLDivElement>(null)
  const mouseDownInsideRef = useRef<boolean>(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    cardRef.current?.focus()
    return () => {
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-0/80 backdrop-blur-sm animate-modal-fade"
      onMouseDown={(e) => {
        // Drag-guard: só fecha se o mousedown começou diretamente no backdrop.
        mouseDownInsideRef.current = e.target !== backdropRef.current
      }}
      onMouseUp={(e) => {
        if (e.target === backdropRef.current && !mouseDownInsideRef.current) {
          onClose()
        }
        mouseDownInsideRef.current = false
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className={cn(
          'bg-surface border border-border-strong rounded-xl shadow-md p-5 outline-none',
          'animate-modal-scale'
        )}
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title ? (
          <h3 className="text-sm font-semibold text-text-primary mb-2">{title}</h3>
        ) : null}
        <div className="text-xs text-text-secondary leading-relaxed">{children}</div>
        {footer ? <div className="mt-4 flex items-center justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  )
}
