import { useEffect, useState } from 'react'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { Input } from '../../shared/components/Input'
import { Modal } from '../../shared/components/Modal'
import { Toggle } from '../../shared/components/Toggle'
import { cn } from '../../shared/lib/cn'
import { getBridge } from '../../shared/hooks/useBridge'

interface VocabRow {
  id: string
  term_wrong: string
  term_correct: string
  case_sensitive: boolean
  scope: string
  times_applied: number
  created_at: string
  updated_at: string
}

const DEMO_VOCAB: VocabRow[] = [
  {
    id: '01HV1',
    term_wrong: 'kunha',
    term_correct: 'Cunha',
    case_sensitive: false,
    scope: 'global',
    times_applied: 14,
    created_at: '',
    updated_at: ''
  },
  {
    id: '01HV2',
    term_wrong: 'react js',
    term_correct: 'React.js',
    case_sensitive: false,
    scope: 'code.exe',
    times_applied: 6,
    created_at: '',
    updated_at: ''
  }
]

export function VocabList(): JSX.Element {
  const [entries, setEntries] = useState<VocabRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const bridge = getBridge()

  const load = async (): Promise<void> => {
    if (!bridge) {
      setEntries(DEMO_VOCAB)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const list = (await bridge.vocab.list()) as VocabRow[]
      setEntries(list ?? [])
    } catch (e) {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const removeEntry = async (): Promise<void> => {
    if (!removingId) return
    if (bridge) await bridge.vocab.remove(removingId)
    setRemovingId(null)
    void load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-primary">Vocabulário custom</h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            Correções aplicadas depois da transcrição — global ou por app.
          </p>
        </div>
        <Button variant="accent-soft" onClick={() => setAdding(true)}>
          + adicionar
        </Button>
      </div>

      {adding ? (
        <VocabForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            void load()
          }}
        />
      ) : null}

      {loading ? (
        <div className="space-y-1.5" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 rounded-md bg-bg-2 border border-border animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-xs text-text-muted">
            Sem vocabulário ainda. Adicione correções recorrentes pra evitar
            re-editar texto depois.
          </p>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => (
            <VocabRowItem
              key={e.id}
              entry={e}
              onRequestRemove={() => setRemovingId(e.id)}
              onChange={() => void load()}
            />
          ))}
        </div>
      )}

      <Modal
        open={Boolean(removingId)}
        onClose={() => setRemovingId(null)}
        title="Remover correção?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemovingId(null)}>
              cancelar
            </Button>
            <Button
              variant="primary"
              className="bg-danger text-text-on-accent hover:bg-danger/90"
              onClick={removeEntry}
            >
              remover
            </Button>
          </>
        }
      >
        Esta correção não vai mais ser aplicada em novas transcrições.
      </Modal>
    </div>
  )
}

function VocabRowItem({
  entry,
  onRequestRemove,
  onChange
}: {
  entry: VocabRow
  onRequestRemove: () => void
  onChange: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [term_wrong, setWrong] = useState(entry.term_wrong)
  const [term_correct, setCorrect] = useState(entry.term_correct)
  const [case_sensitive, setCs] = useState(entry.case_sensitive)
  const [scope, setScope] = useState(entry.scope)
  const bridge = getBridge()

  const save = async (): Promise<void> => {
    if (!term_wrong.trim() || !term_correct.trim()) return
    if (bridge) {
      await bridge.vocab.update({
        id: entry.id,
        term_wrong: term_wrong.trim(),
        term_correct: term_correct.trim(),
        case_sensitive,
        scope: scope.trim() || 'global'
      })
    }
    setEditing(false)
    onChange()
  }

  if (editing) {
    return (
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="errado"
            maxLength={60}
            value={term_wrong}
            onChange={(e) => setWrong(e.target.value)}
          />
          <Input
            label="correto"
            maxLength={120}
            value={term_correct}
            onChange={(e) => setCorrect(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Input
            label="escopo"
            maxLength={32}
            placeholder="global ou exe.exe"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="flex-1"
          />
          <div className="flex items-center gap-2 pt-5">
            <Toggle
              on={case_sensitive}
              onChange={setCs}
              ariaLabel="case sensitive"
            />
            <span className="text-[10px] text-text-muted">case sensitive</span>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditing(false)}>
            cancelar
          </Button>
          <Button variant="primary" onClick={save}>
            salvar
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="px-3 py-2 flex items-center gap-3 group hover:border-accent/20 transition-colors">
      <span className="text-xs text-text-muted line-through font-mono truncate max-w-[120px]">
        {entry.term_wrong}
      </span>
      <span aria-hidden className="text-text-faint">→</span>
      <span className="text-xs text-text-primary font-medium truncate max-w-[160px]">
        {entry.term_correct}
      </span>
      <Badge
        tone={entry.scope === 'global' ? 'accent' : 'info'}
        className={cn('ml-auto', entry.case_sensitive && 'border-warning/30 text-warning')}
      >
        {entry.scope}
      </Badge>
      {entry.case_sensitive ? <Badge tone="warning">Aa</Badge> : null}
      <span className="text-[10px] text-text-faint font-mono tabular-nums">
        ×{entry.times_applied}
      </span>
      <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-accent rounded hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          editar
        </button>
        <button
          type="button"
          onClick={onRequestRemove}
          className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-danger rounded hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          remover
        </button>
      </div>
    </Card>
  )
}

function VocabForm({
  onCancel,
  onSaved
}: {
  onCancel: () => void
  onSaved: () => void
}): JSX.Element {
  const [term_wrong, setWrong] = useState('')
  const [term_correct, setCorrect] = useState('')
  const [case_sensitive, setCs] = useState(false)
  const [scope, setScope] = useState('global')
  const [saving, setSaving] = useState(false)
  const bridge = getBridge()

  const submit = async (): Promise<void> => {
    if (!term_wrong.trim() || !term_correct.trim()) return
    setSaving(true)
    try {
      if (bridge) {
        await bridge.vocab.add({
          term_wrong: term_wrong.trim(),
          term_correct: term_correct.trim(),
          case_sensitive,
          scope: scope.trim() || 'global'
        })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-3 space-y-2 border-accent/30">
      <div className="grid grid-cols-2 gap-2">
        <Input
          label="errado"
          maxLength={60}
          placeholder="ex: kunha"
          value={term_wrong}
          onChange={(e) => setWrong(e.target.value)}
        />
        <Input
          label="correto"
          maxLength={120}
          placeholder="ex: Cunha"
          value={term_correct}
          onChange={(e) => setCorrect(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Input
          label="escopo"
          maxLength={32}
          placeholder="global ou exe.exe"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="flex-1"
        />
        <div className="flex items-center gap-2 pt-5">
          <Toggle on={case_sensitive} onChange={setCs} ariaLabel="case sensitive" />
          <span className="text-[10px] text-text-muted">case sensitive</span>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          cancelar
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={saving || !term_wrong.trim() || !term_correct.trim()}
        >
          {saving ? 'salvando…' : 'adicionar'}
        </Button>
      </div>
    </Card>
  )
}
