/**
 * IPC handlers para histórico de transcrições + export (WO-4).
 *
 * Canais:
 *   history:list       → lista cronológica com filtros + paginação
 *   history:search     → busca FTS5 + filtros
 *   history:get-by-id  → busca singular
 *   history:update     → updateText
 *   history:delete     → remove
 *   history:export     → serializa md/json conforme filtros atuais
 */

import { ipcMain } from 'electron'
import { Channels } from '@shared/ipc-types'
import type {
  HistoryListRequest,
  HistorySearchRequest,
  HistoryExportRequest
} from '@shared/ipc-types'
import type { TranscriptionRepo } from '../repos/transcription-repo.js'
import type { Transcription } from '../../shared/db-types.js'
import { logger } from '../utils/logger.js'

export interface HistoryIpcDeps {
  repo: TranscriptionRepo
}

export function registerHistoryIpcHandlers(deps: HistoryIpcDeps): void {
  ipcMain.handle(Channels.HistoryList, (_e, req: HistoryListRequest = {}) => {
    const limit = req.limit ?? 50
    const offset = req.offset ?? 0
    const rows = deps.repo.list(req.filters ?? {}, limit, offset)
    const total = deps.repo.count(req.filters ?? {})
    // Renderer espera `items` (terminologia da UI); `rows` mantido como alias
    // pra compat com testes / tools externas.
    return { items: rows, rows, total }
  })

  ipcMain.handle(Channels.HistorySearch, (_e, req: HistorySearchRequest) => {
    const rows = deps.repo.search(req.query, {
      filters: req.filters,
      limit: req.limit ?? 50,
      offset: req.offset ?? 0
    })
    return { items: rows, rows, total: rows.length }
  })

  ipcMain.handle(Channels.HistoryGetById, (_e, id: string) => {
    return deps.repo.findById(id)
  })

  ipcMain.handle(Channels.HistoryUpdateText, (_e, payload: { id: string; text: string }) => {
    return deps.repo.updateText(payload.id, payload.text)
  })

  ipcMain.handle(Channels.HistoryDelete, (_e, id: string) => {
    deps.repo.delete(id)
    return { ok: true }
  })

  ipcMain.handle(Channels.HistoryExport, (_e, req: HistoryExportRequest) => {
    const rows = deps.repo.list(req.filters ?? {}, 10_000, 0)
    if (req.format === 'json') {
      return { format: 'json', content: JSON.stringify(rows, null, 2) }
    }
    return { format: 'md', content: renderMarkdown(rows) }
  })

  logger.info({
    event: 'history.ipc.handlers_registered',
    channels: [
      Channels.HistoryList,
      Channels.HistorySearch,
      Channels.HistoryGetById,
      Channels.HistoryUpdateText,
      Channels.HistoryDelete,
      Channels.HistoryExport
    ]
  })
}

function renderMarkdown(rows: Transcription[]): string {
  const lines: string[] = ['# flowtype — histórico de transcrições', '']
  for (const r of rows) {
    const provider = r.provider_used === 'groq' ? `Groq #${(r.slot_index ?? 0) + 1}` : 'local'
    lines.push(`## ${r.ts}  ·  ${provider}  ·  ${r.latency_ms}ms`)
    if (r.app_exe) lines.push(`*${r.app_exe}* — ${r.app_window_title ?? ''}`)
    lines.push('')
    lines.push(r.text)
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  return lines.join('\n')
}
