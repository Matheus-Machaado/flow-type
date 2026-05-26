import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../../../shared/components/Badge'
import { Button } from '../../../shared/components/Button'
import { Card } from '../../../shared/components/Card'
import { Input } from '../../../shared/components/Input'
import { MeterBar } from '../../../shared/components/MeterBar'
import { Modal } from '../../../shared/components/Modal'
import { Toggle } from '../../../shared/components/Toggle'
import { cn } from '../../../shared/lib/cn'
import { formatNumber, pctOf } from '../../../shared/lib/format'
import { getBridge } from '../../../shared/hooks/useBridge'

/**
 * GroqProviderSection — CR-2 reescrito.
 *
 * UI PROGRESSIVA: começa mostrando UM card de slot. Quando user preenche +
 * valida, revela CTA discreto pra adicionar "key alternativa (opcional)".
 * Quando preenche a segunda, revela "terceira (opcional)". Backend continua
 * com 3 slots fixos no `groq_slot_meta` — é só UX que esconde a gambiarra.
 *
 * NUNCA usar labels "Slot #1/#2/#3" ou "Pool de keys" no DOM visível.
 * Permitido: "Sua key Groq" / "Key alternativa (opcional)" / "Terceira key".
 *
 * Aceita `mockSnapshot` pro screenshot harness simular estados específicos.
 */

type SlotIndex = 0 | 1 | 2

interface SlotSnapshotShape {
  slotIndex: SlotIndex
  hasKey: boolean
  label?: string | null
  apiKeyTail?: string
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

// Slot-friendly labels (semantic, never "#N"). Owner pediu textos que escondem
// a gambiarra de 3 slots.
const SLOT_TITLES = ['Sua key Groq', 'Key alternativa', 'Terceira key'] as const
const SLOT_ADD_CTA = [
  'Adicione sua key Groq',
  'adicionar key alternativa (opcional)',
  'adicionar terceira key (opcional)'
] as const

// Empty default snapshot when bridge missing (harness sem electron).
function makeEmptyDefault(): ProviderSettings {
  return {
    stt_force_local: false,
    stt_language: null,
    slots: {
      totalSlots: 3,
      online: 0,
      invalid: 0,
      exhausted: 0,
      totalUsedToday: 0,
      slots: [
        { slotIndex: 0, hasKey: false, status: 'online', usedToday: 0, dailyCap: 14400, pctUsed: 0 },
        { slotIndex: 1, hasKey: false, status: 'online', usedToday: 0, dailyCap: 14400, pctUsed: 0 },
        { slotIndex: 2, hasKey: false, status: 'online', usedToday: 0, dailyCap: 14400, pctUsed: 0 }
      ]
    }
  }
}

// Mock state injection for screenshot harness.
declare global {
  interface Window {
    __flowtypeMock?: {
      providerSettings?: ProviderSettings
      localAvailable?: boolean
      vocabList?: unknown[]
      historyList?: unknown[]
    }
  }
}

export function GroqProviderSection({
  onSaved
}: {
  onSaved?: () => void
}): JSX.Element {
  const [state, setState] = useState<ProviderSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addingIndex, setAddingIndex] = useState<SlotIndex | null>(null)
  const bridge = getBridge()

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    if (!bridge) {
      const mock = (typeof window !== 'undefined' && window.__flowtypeMock?.providerSettings) || null
      setState(mock ?? makeEmptyDefault())
      setLoading(false)
      return
    }
    try {
      const data = (await bridge.stt.getProviderSettings()) as ProviderSettings
      setState(data)
    } catch {
      setError('Não foi possível carregar provider')
    } finally {
      setLoading(false)
    }
  }, [bridge])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!bridge) return
    const id = setInterval(() => void load(), REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [bridge, load])

  // Compute progressive state.
  const slots = state?.slots.slots ?? []
  const filledSlots = useMemo(() => slots.filter((s) => s.hasKey), [slots])
  const nextEmptyIndex = useMemo<SlotIndex | null>(() => {
    const next = slots.find((s) => !s.hasKey)
    return next ? (next.slotIndex as SlotIndex) : null
  }, [slots])

  const filledCount = filledSlots.length
  const canAddMore = nextEmptyIndex !== null

  // Force local enabled?
  const forceLocal = Boolean(state?.stt_force_local)

  const setForceLocal = async (next: boolean): Promise<void> => {
    if (!state) return
    setState({ ...state, stt_force_local: next })
    if (bridge) await bridge.stt.setForceLocal(next)
    onSaved?.()
  }

  const onSlotChange = (): void => {
    void load()
    setAddingIndex(null)
    onSaved?.()
  }

  if (loading && !state) {
    return (
      <div className="space-y-2.5" aria-busy="true">
        <div className="h-[140px] rounded-lg bg-bg-2 border border-border animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Pool summary só aparece se ≥2 slots preenchidos */}
      {filledCount >= 2 && state ? (
        <PoolSummary
          activeCount={filledCount}
          totalUsedToday={state.slots.totalUsedToday}
          totalCap={filledSlots.reduce((a, s) => a + s.dailyCap, 0)}
        />
      ) : null}

      {/* Cards dos slots preenchidos */}
      <div className="space-y-2.5">
        {filledSlots.map((slot, idx) => (
          <FilledKeyCard
            key={slot.slotIndex}
            slot={slot}
            displayTitle={SLOT_TITLES[idx] ?? `Key #${idx + 1}`}
            onChange={onSlotChange}
          />
        ))}
      </div>

      {/* Estado inicial: zero slots ou "adicionando próximo" */}
      {filledCount === 0 && nextEmptyIndex !== null ? (
        <AddKeyCard
          slotIndex={nextEmptyIndex}
          title={SLOT_TITLES[0]}
          description="Free, sem cartão. Crie em console.groq.com em ~30 segundos."
          forceOpen
          onSaved={onSlotChange}
          onCancel={() => setAddingIndex(null)}
        />
      ) : null}

      {/* CTA progressivo discreto pra revelar o próximo slot */}
      {filledCount > 0 && canAddMore && addingIndex === null ? (
        <button
          type="button"
          onClick={() => setAddingIndex(nextEmptyIndex)}
          className="w-full text-left text-[11px] text-text-muted hover:text-accent opacity-80 hover:opacity-100 transition-opacity px-3 py-2 border border-dashed border-border hover:border-accent/40 rounded-md flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span aria-hidden className="text-accent">+</span>
          <span>{SLOT_ADD_CTA[filledCount] ?? 'adicionar outra key (opcional)'}</span>
        </button>
      ) : null}

      {/* Form expandido pro próximo slot */}
      {filledCount > 0 && addingIndex !== null ? (
        <AddKeyCard
          slotIndex={addingIndex}
          title={SLOT_TITLES[filledCount] ?? 'Key adicional'}
          description="Distribui carga e dá fallback se a primeira ficar invalid ou exhausted."
          forceOpen
          onSaved={onSlotChange}
          onCancel={() => setAddingIndex(null)}
        />
      ) : null}

      {/* Force-local toggle */}
      <div className="pt-3 border-t border-border">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-text-primary">
              Forçar fallback local sempre
            </div>
            <div className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
              Pula transcrição cloud — áudio nunca sai da máquina.
            </div>
          </div>
          <Toggle on={forceLocal} onChange={setForceLocal} ariaLabel="Forçar fallback local" />
        </div>
      </div>

      {/* Empty state: zero slots E local indisponível */}
      {filledCount === 0 ? (
        <LocalUnavailableBanner />
      ) : null}

      {/* Inline test card */}
      <TestTranscribeCard />

      {error ? (
        <p className="text-[10px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

// ─── Pool summary (só aparece com ≥2 keys, sem mencionar "3 slots") ──

function PoolSummary({
  activeCount,
  totalUsedToday,
  totalCap
}: {
  activeCount: number
  totalUsedToday: number
  totalCap: number
}): JSX.Element {
  const remaining = Math.max(0, totalCap - totalUsedToday)
  return (
    <div
      className="flex items-center gap-2 text-[10px] font-mono text-text-muted px-1"
      aria-label="Resumo de uso"
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(52,211,153,0.55)]" />
      <span className="text-text-secondary">
        {activeCount} keys ativas
      </span>
      <span className="text-text-faint">·</span>
      <span>
        {formatNumber(remaining)} de {formatNumber(totalCap)} req disponíveis hoje
      </span>
    </div>
  )
}

// ─── Local unavailable banner ────────────────────────────────────────

function LocalUnavailableBanner(): JSX.Element {
  // Could detect via bridge call; ok mostrar warning padrão pra zero-keys
  return (
    <Card className="p-3 border-warning/40 bg-warning/5">
      <div className="flex gap-2 items-start">
        <span aria-hidden className="text-warning text-sm leading-none mt-0.5">
          ⚠
        </span>
        <div className="text-[11px] text-text-secondary leading-relaxed">
          <strong className="text-warning">Sem key Groq cadastrada</strong> — adicione
          uma acima pra transcrição cloud. Se faster-whisper local não estiver
          instalado (Python 3.11+), nenhuma transcrição vai funcionar.
        </div>
      </div>
    </Card>
  )
}

// ─── Filled key card ─────────────────────────────────────────────────

function FilledKeyCard({
  slot,
  displayTitle,
  onChange
}: {
  slot: SlotSnapshotShape
  displayTitle: string
  onChange: () => void
}): JSX.Element {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const bridge = getBridge()

  const tone =
    slot.status === 'online'
      ? 'success'
      : slot.status === 'invalid'
        ? 'danger'
        : 'warning'
  const statusLabel =
    slot.status === 'online'
      ? 'online'
      : slot.status === 'invalid'
        ? 'inválida'
        : 'esgotada'

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
    } catch {
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

  if (editing) {
    return (
      <AddKeyCard
        slotIndex={slot.slotIndex}
        title={displayTitle}
        description="Atualize sua key Groq. Vai re-validar antes de salvar."
        forceOpen
        editing
        initialLabel={slot.label ?? ''}
        initialDailyCap={slot.dailyCap}
        onSaved={() => {
          setEditing(false)
          onChange()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const tail = slot.apiKeyTail ?? 'xxxx'
  const maskedKey = `gsk_•••••${tail}`

  return (
    <>
      <Card className="p-3.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-primary font-medium">
              {displayTitle}
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
              onClick={() => setEditing(true)}
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
              apelido
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
              {maskedKey}
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
        title="Remover key?"
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
        Vai apagar sua "{displayTitle}". Você pode cadastrar outra depois.
        Continuar?
      </Modal>
    </>
  )
}

// ─── Add key card (validation inline) ────────────────────────────────

function AddKeyCard({
  slotIndex,
  title,
  description,
  forceOpen: _forceOpen,
  editing = false,
  initialLabel = '',
  initialDailyCap = 14400,
  onSaved,
  onCancel
}: {
  slotIndex: SlotIndex
  title: string
  description: string
  forceOpen?: boolean
  editing?: boolean
  initialLabel?: string
  initialDailyCap?: number
  onSaved: () => void
  onCancel: () => void
}): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [label, setLabel] = useState(initialLabel)
  const [dailyCap] = useState(initialDailyCap) // hidden — keep default to reduce noise
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bridge = getBridge()

  // Em modo de edição, a key pode ficar em branco (mantém a key atual).
  // Em modo de adição (slot vazio), a key é obrigatória.
  const labelChanged = label !== initialLabel
  const keyFilled = apiKey.length > 0
  const keyValid = apiKey.startsWith('gsk_') && apiKey.length >= 20
  const canSubmit = useMemo(() => {
    if (editing) {
      // Salvar OK se: usuário só quer mudar label (key em branco), OU forneceu key nova válida
      if (!keyFilled) return labelChanged
      return keyValid
    }
    return keyValid
  }, [editing, keyFilled, keyValid, labelChanged])

  const submit = async (): Promise<void> => {
    if (editing && keyFilled && !keyValid) {
      setError('A key precisa começar com gsk_ e ter pelo menos 20 caracteres.')
      return
    }
    if (!editing && !keyValid) {
      setError('A key precisa começar com gsk_ e ter pelo menos 20 caracteres.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      if (!bridge) {
        setSaving(false)
        onSaved()
        return
      }
      // Em edição sem key nova: omite apiKey → backend preserva a atual.
      const r = (editing
        ? await bridge.stt.updateSlot({
            slotIndex,
            apiKey: keyFilled ? apiKey : undefined,
            label: label || undefined,
            dailyCap
          })
        : await bridge.stt.addSlot({
            slotIndex,
            apiKey,
            label: label || undefined,
            dailyCap
          })) as { ok: boolean; validation: { error?: string } }
      if (!r.ok) {
        setError(r.validation?.error ?? 'Key rejeitada pelo Groq')
        setSaving(false)
        return
      }
      onSaved()
    } catch {
      setError('Erro ao validar')
      setSaving(false)
    }
  }

  return (
    <Card className="p-3.5 border-accent/30">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs font-medium text-text-primary">{title}</div>
          <div className="text-[10px] text-text-muted mt-0.5">{description}</div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-text-muted hover:text-text-primary rounded px-2 py-0.5 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          cancelar
        </button>
      </div>

      <div className="space-y-2.5">
        <Input
          label="API key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          placeholder={editing ? 'Deixe em branco pra manter a atual' : 'gsk_xxxxxxxxxxxxxxxx'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value.trim())}
          invalid={Boolean(error && !canSubmit)}
          hint={
            editing
              ? 'Em branco mantém a key atual. Cole uma key nova só se quiser trocar.'
              : 'Pegamos do console.groq.com. Validamos antes de salvar.'
          }
        />

        <Input
          label="Apelido (opcional)"
          placeholder="ex: pessoal, trabalho"
          maxLength={32}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />

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
            className={cn(saving && 'opacity-80')}
          >
            {saving ? 'validando…' : editing ? 'salvar' : 'validar e salvar'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ─── Inline test card ────────────────────────────────────────────────

function TestTranscribeCard(): JSX.Element {
  const [recording, setRecording] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const bridge = getBridge()

  const runTest = async (): Promise<void> => {
    if (recording) return
    setRecording(true)
    setResult(null)
    try {
      if (!bridge || typeof navigator === 'undefined' || !navigator.mediaDevices) {
        setTimeout(() => {
          // Demo result, sem "#N" / sem slot index visível.
          setResult('"olá Flow Type, isso é um teste" · cloud · 720ms')
          setRecording(false)
        }, 800)
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (ev) => chunks.push(ev.data)
      recorder.start()
      await new Promise((r) => setTimeout(r, 3000))
      recorder.stop()
      await new Promise<void>((r) => (recorder.onstop = () => r()))
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: 'audio/webm' })
      const buf = await blob.arrayBuffer()
      const r = (await bridge.stt.testTranscribe(buf)) as {
        text: string
        provider: string
        latencyMs: number
      }
      // Mostra "cloud" ou "local" SEM expor slotIndex.
      const tag = r.provider === 'groq' ? 'cloud' : 'local'
      setResult(`"${r.text}" · ${tag} · ${r.latencyMs}ms`)
    } catch {
      setResult('erro ao testar')
    } finally {
      setRecording(false)
    }
  }

  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-text-primary">
          Testar transcrição
        </span>
        <span className="text-[10px] text-text-muted">grava 3s e mostra latência</span>
      </div>
      <Button
        variant="accent-soft"
        size="md"
        onClick={runTest}
        disabled={recording}
        className="w-full"
      >
        {recording ? 'gravando…' : 'gravar 3s e testar'}
      </Button>
      {result ? (
        <div className="mt-3 text-[10px] font-mono text-text-muted" role="status">
          último teste: <span className="text-accent">{result}</span>
        </div>
      ) : null}
    </Card>
  )
}
