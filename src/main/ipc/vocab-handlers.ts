/**
 * IPC handlers para vocab CRUD (WO-4).
 *
 * Canais:
 *   vocab:list   → lista todas entries
 *   vocab:add    → adiciona com validação
 *   vocab:update → patch parcial
 *   vocab:remove → delete
 */

import { ipcMain } from 'electron'
import { Channels } from '@shared/ipc-types'
import type { VocabAddRequest, VocabUpdateRequest } from '@shared/ipc-types'
import type { VocabRepo } from '../repos/vocab-repo.js'
import { logger } from '../utils/logger.js'

export interface VocabIpcDeps {
  repo: VocabRepo
}

export function registerVocabIpcHandlers(deps: VocabIpcDeps): void {
  ipcMain.handle(Channels.VocabList, () => {
    return deps.repo.list()
  })

  ipcMain.handle(Channels.VocabAdd, (_e, entry: VocabAddRequest) => {
    return deps.repo.add({
      term_wrong: entry.term_wrong,
      term_correct: entry.term_correct,
      case_sensitive: entry.case_sensitive ?? false,
      scope: entry.scope ?? 'global'
    })
  })

  ipcMain.handle(Channels.VocabUpdate, (_e, patch: VocabUpdateRequest) => {
    const { id, ...rest } = patch
    return deps.repo.update(id, rest)
  })

  ipcMain.handle(Channels.VocabRemove, (_e, id: string) => {
    deps.repo.remove(id)
    return { ok: true }
  })

  logger.info({
    event: 'vocab.ipc.handlers_registered',
    channels: [Channels.VocabList, Channels.VocabAdd, Channels.VocabUpdate, Channels.VocabRemove]
  })
}
