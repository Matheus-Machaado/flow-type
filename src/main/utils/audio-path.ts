/**
 * Helpers de caminho pra storage de áudios.
 * Layout: <appData>/flowtype/recordings/YYYY-MM-DD/<ulid>.opus
 * Cobre e6-audio-storage-path.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolve a raiz de áudios. Se Electron estiver disponível usa
 * `app.getPath('userData')`; caso contrário (testes/CLI), fallback pra
 * variável de ambiente `FLOWTYPE_DATA_DIR` ou `os.tmpdir()`.
 */
export function getRecordingsRoot(): string {
  const override = process.env.FLOWTYPE_DATA_DIR;
  if (override) return join(override, 'recordings');

  try {
    // Import dinâmico evita quebrar testes que rodam fora do Electron.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return join(app.getPath('userData'), 'recordings');
    }
  } catch {
    // electron não disponível (ex.: vitest)
  }

  // Fallback final
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os');
  return join(os.tmpdir(), 'flowtype', 'recordings');
}

/**
 * Retorna o caminho absoluto onde o áudio de `transcriptionId` será salvo,
 * criando o diretório do dia se não existir.
 *
 * @param transcriptionId ULID da transcrição (também usado como nome do arquivo)
 * @param day 'YYYY-MM-DD' (UTC). Default: hoje.
 */
export function audioPathFor(transcriptionId: string, day?: string): string {
  const root = getRecordingsRoot();
  const targetDay = day ?? new Date().toISOString().slice(0, 10);
  const dir = join(root, targetDay);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, `${transcriptionId}.opus`);
}

/**
 * Retorna o path relativo (formato armazenado em transcription.audio_path).
 */
export function relativeAudioPath(transcriptionId: string, day?: string): string {
  const targetDay = day ?? new Date().toISOString().slice(0, 10);
  return `${targetDay}/${transcriptionId}.opus`;
}

/**
 * Resolve um path relativo (forma armazenada no DB) pra absoluto.
 */
export function resolveAudioFullPath(relative: string): string {
  return join(getRecordingsRoot(), relative);
}
