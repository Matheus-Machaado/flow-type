import { useEffect, useState } from 'react'
import { Toggle } from '../../../shared/components/Toggle'
import { getBridge } from '../../../shared/hooks/useBridge'

/**
 * AutoStartSection — toggle pra iniciar com o Windows.
 */
export function AutoStartSection({ onSaved }: { onSaved?: () => void }): JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const bridge = getBridge()

  useEffect(() => {
    if (!bridge) return
    void (async () => {
      const all = (await bridge.settings.getAll()) as { auto_start?: boolean }
      setEnabled(Boolean(all.auto_start))
    })()
    return bridge.settings.onChange((key, value) => {
      if (key === 'auto_start') setEnabled(Boolean(value))
    })
  }, [bridge])

  const update = async (next: boolean): Promise<void> => {
    setEnabled(next)
    if (bridge) await bridge.app.autoStartSet(next)
    onSaved?.()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between py-3 border-b border-border gap-4">
        <div>
          <div className="text-xs text-text-secondary">Iniciar com o Windows</div>
          <div className="text-[10px] text-text-muted mt-0.5">
            Sobe minimizado no tray quando o Windows inicia.
          </div>
        </div>
        <Toggle on={enabled} onChange={update} ariaLabel="Iniciar Flow Type com o Windows" />
      </div>
      <p className="text-[10px] text-text-muted leading-relaxed">
        Útil pra não esquecer de abrir. Você pode sempre fechar pela bandeja.
      </p>
    </div>
  )
}
