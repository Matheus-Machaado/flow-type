#!/usr/bin/env python3
"""
flowtype — faster-whisper runner stub (WO-2 v0.1).

DESVIO ACEITO em WO-2: bundling completo do binário standalone (PyInstaller +
small.en ~140MB) fica pra WO-8 (Roberto + electron-builder asarUnpack /
extraResources). Por ora este script tenta importar `faster_whisper` no Python
do sistema. Se ausente, sai com código 1 e ModuleNotFoundError visível no stderr
(o provider TS captura e converte em LocalUnavailableError com mensagem PT-BR).

Uso:
  python whisper-runner.py --model small.en --audio /tmp/audio.bin [--language pt]

Saída (stdout, ÚLTIMA linha):
  { "text": "...", "language": "pt" }

Instalação no dev (Windows):
  1. Instalar Python 3.11+ de python.org (PATH habilitado)
  2. pip install faster-whisper
  3. Reabrir flowtype (auto-detect)

Em WO-8: bundling de python embeddable + faster_whisper pré-instalado +
modelo small.en (~140MB) substitui essa dependência manual.
"""

from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="flowtype faster-whisper runner")
    parser.add_argument("--model", default="small.en", help="Whisper model size")
    parser.add_argument("--audio", required=True, help="Path to audio file (binary)")
    parser.add_argument("--language", default=None, help="Language code (ISO 639-1)")
    args = parser.parse_args()

    try:
        # Import lazy — falha aqui vira ModuleNotFoundError, que o provider TS
        # interpreta como "instale Python 3.11+ e pip install faster-whisper".
        from faster_whisper import WhisperModel  # type: ignore
    except ModuleNotFoundError as e:
        print(f"ModuleNotFoundError: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # noqa: BLE001
        print(f"ImportError: {e}", file=sys.stderr)
        return 1

    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            args.audio,
            language=args.language,
            beam_size=1,
            vad_filter=True,
        )
        text = "".join(seg.text for seg in segments).strip()
        detected_language = getattr(info, "language", None) or args.language

        # ÚLTIMA linha do stdout precisa ser JSON parseável.
        print(json.dumps({"text": text, "language": detected_language}, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"TranscribeError: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
