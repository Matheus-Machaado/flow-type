import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { Input } from '../../shared/components/Input'
import { MeterBar } from '../../shared/components/MeterBar'
import { Modal } from '../../shared/components/Modal'
import { Toggle } from '../../shared/components/Toggle'
import { cn } from '../../shared/lib/cn'
import { formatNumber, maskApiKey, pctOf } from '../../shared/lib/format'
import { getBridge } from '../../shared/hooks/useBridge'

/**
 * GroqSlotManager — componente crítico CR-1.
 *
 * Renderiza 3 slots horizontais (full) ou só o slot #1 (compact, usado no
 * onboarding step 4 do WO-5). Lê estado via `stt:get-provider-settings`,
 * mutações via `stt:add-slot/update-slot/remove-slot/test-slot`. Pool summary
 * no topo + force-local toggle + auto-refresh 30s.
 *
 * Anti-pattern guardrails (lições do dono):
 *   - daily-cap aceita só números (lição feedback_input_masks_default)
 *   - apiKey é password type sem leak no DOM (mascara via maskApiKey)
 *   - confirmação inline pra remover (modal drag-safe — feedback_modal_close_drag_guard)
 *   - sem dev info exposta (feedback_no_dev_leaks_in_ui)
 */

type SlotIndex = 0 | 1 | 2

interface SlotSnapshotShape {
  slotIndex: SlotIndex
  hasKey: boolean
  label?: string
  status: 'online' | 'invalid' | 'exhausted'
  usedToday: number
  dailyCap: number
  pctUsed: number
  lastValidatedAt?: string
}

interface PoolSnapshotShape {
  totalSlots: 3
  online: number
  invalid: number
  exhausted: number
  totalUsedToday: number
  slots: SlotSnapshotShape[]
}

interface ProviderSettings {
  stt_force_local: boolean
  stt_language: string | null
  slots: PoolSnapshotShape
}

const REFRESH_INTERVAL_MS = 30_000

const DAILY_CAP_PRESETS = [
  { value: 14400, label: '14.4k (Tier 0 free)' },
  { value: 7200, label: '7.2k' },
  { value: 3600, label: '3.6k' }
]

const DEMO_SNAPSHOT: ProviderSettings = {
  stt_force_local: false,
  stt_language: null,
  slots: {
    totalSlots: 3,
    online: 2,
    invalid: 0,
    exhausted: 0,
    totalUsedToday: 8400,
    slots: [
      {
        slotIndex: 0,
        hasKey: true,
        label: 'primary',
        status: 'online',
        usedToday: 1200,
        dailyCap: 14400,
        pctUsed: 8
      },
      {
        slotIndex: 1,
        hasKey: true,
        label: 'backup-conta-2',
        status: 'online',
        usedToday: 3400,
        dailyCap: 14400,
        pctUsed: 24
      },
      {
        slotIndex: 2,
        hasKey: false,
        status: 'online',
        usedToday: 0,
        dailyCap: 14400,
        pctUsed: 0
      }
    ]
  }
}

export function GroqSlotManager({
  mode = 'full'
}: {
  mode?: 'full' | 'compact'
}): JSX.Element {
  const [state, setState] = useState<ProviderSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const bridge = getBridge()

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    if (!bridge) {
      // Demo mode — usado pela auditoria visual sem Electron.
      setState(DEMO_SNAPSHOT)
      setLoading(false)
      return
    }
    try {
      const data = (await bridge.stt.getProviderSettings()) as ProviderSettings
      setState(data)
    } catch (e) {
      setError('Não foi possível carregar pool')
    } finally {
      setLoading(false)
    }
  }, [bridge])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!bridge) return
    const id = setInterval(() => {
      void load()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [bridge, load])

  const slots = state?.slots.slots ?? []
  const visibleSlots = mode === 'compact' ? slots.slice(0, 1) : slots

  return (
    <div className="space-y-3">
      {loading && !state ? (
        <div className="space-y-2.5" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[100px] rounded-lg bg-bg-2 border border-border animate-pulse"
            />
          ))}
        </div>
      ) : (
        <>
          {state ? <PoolSummary snapshot={state.slots} /> : null}
          <div className="space-y-2.5">
            {visibleSlots.map((slot) => (
              <SlotCard
                key={slot.slotIndex}
                slot={slot}
                onChange={() => void load()}
              />
            ))}
          </div>

          {mode === 'full' && state ? (
            <ForceLocalRow
              enabled={state.stt_force_local}
              onChange={async (next) => {
                if (!bridge) {
                  setState({ ...state, stt_force_local: next })
                  return
                }
                await bridge.stt.setForceLocal(next)
                setState({ ...state, stt_force_local: next })
              }}
            />
          ) : null}

          {error ? (
            <p className="text-[10px] text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function PoolSummary({ snapshot }: { snapshot: PoolSnapshotShape }): JSX.Element {
  const dots = [0, 1, 2].map((i) => {
    const s = snapshot.slots.find((x) => x.slotIndex === i)
    if (!s || !s.hasKey) return 'empty' as const
    return s.status
  })

  const totalCap = snapshot.slots.reduce(
    (acc, s) => acc + (s.hasKey ? s.dailyCap : 0),
    0
  )
  const remaining = Math.max(0, totalCap - snapshot.totalUsedToday)

  return (
    <Card className="p-3 flex items-center gap-3" aria-label="Resumo do pool Groq">
      <div className="flex items-center gap-2">
        {dots.map((status, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              'w-2 h-2 rounded-full',
              status === 'online' && 'bg-success shadow-[0_0_6px_rgba(52,211,153,0.55)]',
              status === 'invalid' && 'bg-danger',
              status === 'exhausted' && 'bg-warning',
              status === 'empty' && 'bg-text-faint'
            )}
          />
        ))}
      </div>
      <div className="text-xs">
        <span className="text-text-primary font-medium">
          {snapshot.online} de 3 slots ativos
        </span>
        <span className="text-text-muted"> · </span>
        <span className="text-text-muted">
          {formatNumber(remaining)} / {formatNumber(totalCap || 0)} req disponíveis hoje
        </span>
      </div>
    </Card>
  )
}

function ForceLocalRow({
  enabled,
  onChange
}: {
  enabled: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-between pt-2 border-t border-border">
      <div>
        <div className="text-xs font-medium text-text-primary">
          Forçar fallback local sempre
        </div>
        <div className="text-[10px] text-text-muted mt-0.5">
          Pula Groq pool — usa faster-whisper local
        </div>
      </div>
      <Toggle on={enabled} onChange={onChange} ariaLabel="Forçar fallback local" />
    </div>
  )
}

// ─── Slot card ─────────────────────────────────────────────────────────

function SlotCard({
  slot,
  onChange
}: {
  slot: SlotSnapshotShape
  onChange: () => void
}): JSX.Element {
  const [mode, setMode] = useState<'idle' | 'edit'>('idle')
  if (slot.hasKey) {
    return mode === 'edit' ? (
      <SlotForm
        slot={slot}
        onDone={() => {
          setMode('idle')
          onChange()
        }}
        onCancel={() => setMode('idle')}
      />
    ) : (
      <FilledSlotCard slot={slot} onEdit={() => setMode('edit')} onChange={onChange} />
    )
  }
  return mode === 'edit' ? (
    <SlotForm
      slot={slot}
      onDone={() => {
        setMode('idle')
        onChange()
      }}
      onCancel={() => setMode('idle')}
    />
  ) : (
    <EmptySlotCard slot={slot} onAdd={() => setMode('edit')} />
  )
}

function EmptySlotCard({
  slot,
  onAdd
}: {
  slot: SlotSnapshotShape
  onAdd: () => void
}): JSX.Element {
  return (
    <Card interactive className="border-dashed">
      <button
        type="button"
        onClick={onAdd}
        className="w-full text-left p-3.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
        aria-label={`Adicionar key no slot ${slot.slotIndex + 1}`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-mono text-text-faint uppercase tracking-wider group-hover:text-text-muted">
            Slot #{slot.slotIndex + 1}
          </span>
          <Badge tone="muted">vazio</Badge>
        </div>
        <div className="flex items-center justify-center gap-2 py-3">
          <span
            aria-hidden
            className="w-7 h-7 rounded-full border border-dashed border-text-faint group-hover:border-accent group-hover:text-accent flex items-center justify-center text-text-faint text-lg leading-none transition-colors"
          >
            +
          </span>
          <div className="text-left">
            <div className="text-xs text-text-secondary group-hover:text-text-primary">
              Adicionar key Groq
            </div>
            <div className="text-[10px] text-text-faint">+14.4k req/dia grátis</div>
          </div>
        </div>
      </button>
    </Card>
  )
}

function FilledSlotCard({
  slot,
  onEdit,
  onChange
}: {
  slot: SlotSnapshotShape
  onEdit: () => void
  onChange: () => void
}): JSX.Element {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const bridge = getBridge()

  const tone =
    slot.status === 'online' ? 'success' : slot.status === 'invalid' ? 'danger' : 'warning'
  const statusLabel =
    slot.status === 'online' ? 'online' : slot.status === 'invalid' ? 'invalid' : 'exhausted'

  const test = async (): Promise<void> => {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    try {
      if (!bridge) {
        setTimeout(() => {
          setTestResult('ok · 480ms')
          setTesting(false)
        }, 400)
        return
      }
      const r = (await bridge.stt.testSlot(slot.slotIndex)) as {
        valid: boolean
        error?: string
        latencyMs: number
      }
      setTestResult(r.valid ? `ok · ${r.latencyMs}ms` : `falha · ${r.error ?? 'erro'}`)
      onChange()
    } catch (e) {
      setTestResult('erro de rede')
    } finally {
      setTesting(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!bridge) {
      setConfirmRemove(false)
      return
    }
    await bridge.stt.removeSlot(slot.slotIndex)
    setConfirmRemove(false)
    onChange()
  }

  return (
    <>
      <Card className="p-3.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
              Slot #{slot.slotIndex + 1}
            </span>
            <Badge tone={tone} dot>
              {statusLabel}
            </Badge>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={test}
              disabled={testing}
              className="px-2 py-0.5 text-[10px] text-text-muted hover:text-accent rounded hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {testing ? 'testando…' : 'testar'}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="px-2 py-0.5 text-[10px] text-text-muted hover:text-accent rounded hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              editar
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="px-2 py-0.5 text-[10px] text-text-muted hover:text-danger rounded hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              remover
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <div className="text-[9px] text-text-faint uppercase tracking-wider mb-0.5">
              label
            </div>
            <div className="text-xs text-text-primary font-medium truncate">
              {slot.label ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-text-faint uppercase tracking-wider mb-0.5">
              key
            </div>
            <div className="text-xs text-text-secondary font-mono truncate">
              {maskApiKey(slot.label ? `gsk_${slot.label}xxxx` : null) || 'gsk_•••••'}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono mb-1">
          <span className="text-text-muted">
            {formatNumber(slot.usedToday)} / {formatNumber(slot.dailyCap)} req hoje
          </span>
          <span className="text-accent">{pctOf(slot.usedToday, slot.dailyCap)}%</span>
        </div>
        <MeterBar value={slot.usedToday} max={slot.dailyCap} />

        {testResult ? (
          <div className="mt-2 text-[10px] font-mono text-text-muted" role="status">
            último teste: <span className="text-accent">{testResult}</span>
          </div>
        ) : null}
      </Card>

      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remover slot?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              cancelar
            </Button>
            <Button
              variant="primary"
              className="bg-danger text-text-on-accent hover:bg-danger/90"
              onClick={remove}
            >
              remover
            </Button>
          </>
        }
      >
        Vai esvaziar o slot #{slot.slotIndex + 1}. Você pode cadastrar outra key
        depois. Continuar?
      </Modal>
    </>
  )
}

// ─── Slot form (add/edit) ───────────────────────────────────────────────

function SlotForm({
  slot,
  onDone,
  onCancel
}: {
  slot: SlotSnapshotShape
  onDone: () => void
  onCancel: () => void
}): JSX.Element {
  const editing = slot.hasKey
  const [apiKey, setApiKey] = useState('')
  const [label, setLabel] = useState<string>(slot.label ?? '')
  const [dailyCap, setDailyCap] = useState<number>(slot.dailyCap || 14400)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bridge = getBridge()

  const canSubmit = useMemo(() => apiKey.startsWith('gsk_') && apiKey.length >= 20, [apiKey])

  const submit = async (): Promise<void> => {
    if (!canSubmit) {
      setError('Key deve começar com gsk_ e ter pelo menos 20 caracteres.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      if (!bridge) {
        // Demo — apenas finaliza.
        setSaving(false)
        onDone()
        return
      }
      const op = editing ? bridge.stt.updateSlot : bridge.stt.addSlot
      const r = (await op({
        slotIndex: slot.slotIndex,
        apiKey,
        label: label || undefined,
        dailyCap
      })) as { ok: boolean; validation: { error?: string } }
      if (!r.ok) {
        setError(r.validation?.error ?? 'Key rejeitada')
        setSaving(false)
        return
      }
      onDone()
    } catch (e) {
      setError('Erro ao salvar')
      setSaving(false)
    }
  }

  return (
    <Card className="p-3.5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
            Slot #{slot.slotIndex + 1}
          </span>
          <Badge tone="accent">{editing ? 'editando' : 'adicionando'}</Badge>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-text-muted hover:text-text-primary rounded px-2 py-0.5 hover:bg-surface"
        >
          cancelar
        </button>
      </div>

      <div className="space-y-3">
        <Input
          label="API key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          placeholder="gsk_xxxxxxxxxxxxxxxx"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value.trim())}
          invalid={Boolean(error && !canSubmit)}
          hint="Cole sua API key Groq — validamos antes de salvar."
        />

        <Input
          label="label"
          placeholder="ex: primary, backup"
          maxLength={32}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />

        <div>
          <span className="block text-[10px] uppercase tracking-wider text-text-faint mb-1 font-mono">
            daily cap (req/dia)
          </span>
          <div className="flex gap-1">
            {DAILY_CAP_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setDailyCap(preset.value)}
                className={cn(
                  'flex-1 h-8 rounded-md text-[10px] border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  dailyCap === preset.value
                    ? 'bg-accent/15 border-accent/40 text-accent'
                    : 'bg-bg-2 border-border text-text-muted hover:text-text-primary'
                )}
              >
                {formatNumber(preset.value)}
              </button>
            ))}
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={dailyCap}
              onChange={(e) => {
                const n = parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
                setDailyCap(Math.max(1, Math.min(999_999, n)))
              }}
              className="w-20 h-8 px-2 rounded-md bg-bg-2 border border-border text-[10px] text-text-primary font-mono text-center focus:outline-none focus:border-accent/60"
              aria-label="custom daily cap"
            />
          </div>
        </div>

        {error ? (
          <div className="text-[10px] text-danger" role="alert">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel}>
            cancelar
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={saving || !canSubmit}
          >
            {saving ? 'validando…' : 'validar e salvar'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
