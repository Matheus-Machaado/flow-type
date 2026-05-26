/**
 * FasterWhisperLocalProvider — fallback offline via Python faster-whisper (e2-faster-whisper-local).
 *
 * v0.1 DESVIO: bundling completo do binário standalone (PyInstaller + small.en
 * ~140MB) fica pra WO-8 (Roberto + electron-builder asarUnpack/extraResources).
 * Por ora detecta `python` no PATH e tenta importar `faster_whisper`. Se ausente,
 * lança LocalUnavailableError com mensagem PT-BR clara — o owner sabe o que fazer
 * (e CLI/install guide cobre instalação).
 *
 * Implementação:
 *   1. Salva audio em arquivo temp.
 *   2. Spawn `python resources/whisper-runner.py` passando path do audio + modelo.
 *   3. Lê JSON do stdout do script.
 *   4. Retorna TranscribeResult { provider: 'local', slotIndex: undefined }.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { logger } from '../utils/logger.js';
import {
  GroqTimeoutError,
  LocalSttSpawnError,
  LocalUnavailableError,
  type SttProvider,
  type TranscribeOptions,
  type TranscribeResult,
} from './stt-types.js';
import { newId } from '../utils/ulid.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'small.en';

export type FasterWhisperModelSize =
  | 'tiny'
  | 'tiny.en'
  | 'base'
  | 'base.en'
  | 'small'
  | 'small.en'
  | 'medium'
  | 'medium.en';

export interface FasterWhisperLocalProviderOptions {
  /** Default 'small.en' — bundled pra fallback offline EN. */
  modelSize?: FasterWhisperModelSize;
  /** Default 30s — local STT pode demorar em CPU. */
  timeoutMs?: number;
  /** Path do script Python helper. Default resources/whisper-runner.py. */
  scriptPath?: string;
  /** Binário Python a usar. Default 'python' (cross-OS friendly). */
  pythonBin?: string;
  /** Override pra fixar latência em testes. */
  now?: () => number;
  /** Override do spawn (testes). */
  spawnFn?: typeof spawn;
}

export class FasterWhisperLocalProvider implements SttProvider {
  readonly name = 'local' as const;

  private readonly modelSize: FasterWhisperModelSize;
  private readonly timeoutMs: number;
  private readonly scriptPath: string;
  private readonly pythonBin: string;
  private readonly now: () => number;
  private readonly spawnImpl: typeof spawn;

  constructor(opts: FasterWhisperLocalProviderOptions = {}) {
    this.modelSize = opts.modelSize ?? DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scriptPath = opts.scriptPath ?? defaultScriptPath();
    this.pythonBin = opts.pythonBin ?? 'python';
    this.now = opts.now ?? (() => Date.now());
    this.spawnImpl = opts.spawnFn ?? spawn;
  }

  /**
   * Tenta detectar `python -c "import faster_whisper"`. Cache por process —
   * uma vez disponível, sempre disponível (a menos que o user remova a lib).
   */
  async isAvailable(): Promise<boolean> {
    if (!existsSync(this.scriptPath)) {
      return false;
    }
    return new Promise<boolean>((res) => {
      const child = this.spawnImpl(this.pythonBin, [
        '-c',
        'import faster_whisper; print("ok")',
      ]);
      let okSeen = false;
      child.stdout?.on('data', (d) => {
        if (d.toString().includes('ok')) okSeen = true;
      });
      child.on('error', () => res(false));
      child.on('exit', (code) => res(code === 0 && okSeen));
    });
  }

  async transcribe(
    audio: ArrayBuffer,
    opts: TranscribeOptions = {},
  ): Promise<TranscribeResult> {
    if (!existsSync(this.scriptPath)) {
      logger.warn({
        event: 'local.transcribe.script_missing',
        scriptPath: this.scriptPath,
      });
      throw new LocalUnavailableError(
        `Script Python não encontrado em ${this.scriptPath} — fallback local indisponível`,
      );
    }

    // Persiste audio temp pra passar caminho pro child Python.
    const dir = tmpdir();
    mkdirSync(dir, { recursive: true });
    const tmpAudio = join(dir, `flowtype-stt-${newId()}.bin`);
    writeFileSync(tmpAudio, Buffer.from(audio));

    const t0 = this.now();
    try {
      const result = await this.runChild(tmpAudio, opts.language);
      const latencyMs = this.now() - t0;
      logger.info({
        event: 'local.transcribe.ok',
        latency_ms: latencyMs,
        text_chars: result.text.length,
        language: result.language,
      });
      return {
        text: result.text,
        latencyMs,
        provider: 'local',
        language: result.language ?? opts.language,
      };
    } finally {
      try {
        unlinkSync(tmpAudio);
      } catch {
        /* swallow */
      }
    }
  }

  private async runChild(
    audioPath: string,
    language?: string,
  ): Promise<{ text: string; language?: string }> {
    return new Promise((res, rej) => {
      const args = [this.scriptPath, '--model', this.modelSize, '--audio', audioPath];
      if (language) {
        args.push('--language', shortLanguageCode(language));
      }

      const child = this.spawnImpl(this.pythonBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutBuf = '';
      let stderrBuf = '';
      let killedForTimeout = false;
      const timeoutHandle = setTimeout(() => {
        killedForTimeout = true;
        try {
          child.kill();
        } catch {
          /* swallow */
        }
      }, this.timeoutMs);

      child.stdout?.on('data', (d) => {
        stdoutBuf += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderrBuf += d.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          rej(
            new LocalUnavailableError(
              `[transcrição local indisponível — instale Python 3.11+ e 'pip install faster-whisper']`,
            ),
          );
          return;
        }
        rej(new LocalSttSpawnError(`spawn ${this.pythonBin} falhou: ${err.message}`));
      });

      child.on('exit', (code) => {
        clearTimeout(timeoutHandle);
        if (killedForTimeout) {
          rej(new GroqTimeoutError(`faster-whisper timeout após ${this.timeoutMs}ms`));
          return;
        }
        if (code !== 0) {
          // stderr pode conter ModuleNotFoundError do faster_whisper.
          if (stderrBuf.includes('ModuleNotFoundError') || stderrBuf.includes('No module named')) {
            rej(
              new LocalUnavailableError(
                `[transcrição local indisponível — instale Python 3.11+ e 'pip install faster-whisper']`,
              ),
            );
            return;
          }
          rej(new LocalSttSpawnError(`whisper-runner exit ${code}: ${stderrBuf.slice(0, 200)}`));
          return;
        }
        try {
          // Aceita a última linha JSON do stdout (pra robustez se Python imprime logs antes).
          const lines = stdoutBuf
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.startsWith('{') && l.endsWith('}'));
          const lastJson = lines[lines.length - 1] ?? '';
          const parsed = JSON.parse(lastJson) as { text?: string; language?: string };
          res({
            text: typeof parsed.text === 'string' ? parsed.text : '',
            language: typeof parsed.language === 'string' ? parsed.language : undefined,
          });
        } catch (parseErr) {
          rej(
            new LocalSttSpawnError(
              `falha parse JSON do whisper-runner: ${(parseErr as Error).message}`,
            ),
          );
        }
      });
    });
  }
}

function defaultScriptPath(): string {
  // Em dev e em build, resources/ fica no root do app. resolve absoluto pra
  // não depender do cwd do processo Electron.
  return resolve(process.cwd(), 'resources', 'whisper-runner.py');
}

function shortLanguageCode(lang: string): string {
  return lang.toLowerCase().split('-')[0];
}
