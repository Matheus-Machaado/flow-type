import { useEffect, useState } from 'react'
import { HotkeyCapture } from '../HotkeyCapture'
import { Toggle } from '../../../shared/components/Toggle'
import { getBridge } from '../../../shared/hooks/useBridge'

/**
 * HotkeySection — captura combo + toggle silenciar.
 */
export function HotkeySection({ onSaved }: { onSaved?: () => void }): JSX.Element {
  const [hotkey, setHotkey] = useState('Right Ctrl')
  const [muted, setMuted] = useState(false)
  const bridge = getBridge()

  useEffect(() => {
    if (!bridge) return
    void (async () => {
      const all = (await bridge.settings.getAll()) as { hotkey?: string; muted?: boolean }
      if (all.hotkey) setHotkey(all.hotkey)
      if (typeof all.muted === 'boolean') setMuted(all.muted)
    })()
    return bridge.settings.onChange((key, value) => {
      if (key === 'hotkey') setHotkey(String(value))
      if (key === 'muted') setMuted(Boolean(value))
    })
  }, [bridge])

  const updateHotkey = async (combo: string): Promise<void> => {
    setHotkey(combo)
    if (bridge) await bridge.hotkey.setBinding(combo)
    onSaved?.()
  }

  const updateMuted = async (next: boolean): Promise<void> => {
    setMuted(next)
    if (bridge) await bridge.app.toggleMute()
    onSaved?.()
  }

  return (
    <div className="space-y-3">
      <Row label="Hotkey de gravação" hint="Segure pra gravar, solte pra enviar.">
        <HotkeyCapture current={hotkey} onSave={updateHotkey} />
      </Row>
      <Row label="Silenciar hotkey" hint="Útil em call ou apresentação.">
        <Toggle on={muted} onChange={updateMuted} ariaLabel="Silenciar hotkey" />
      </Row>
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0 gap-4">
      <div>
        <div className="text-xs text-text-secondary">{label}</div>
        {hint ? <div className="text-[10px] text-text-muted mt-0.5">{hint}</div> : null}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
