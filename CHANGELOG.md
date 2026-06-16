# Changelog

Todas as mudanças notáveis do Flow Type ficam aqui. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/), versionamento [SemVer](https://semver.org/).

## [0.1.8] — 2026-06-16

### Corrigido
- **Hotkey aceita qualquer tecla, não só uma lista fixa.** Antes só funcionavam Right/Left Ctrl e algumas F (F8, F9, F12); qualquer outra tecla era cadastrada mas nunca disparava. Em PC sem Ctrl direito (notebook/netbook), dá pra usar **AltGr**, qualquer **F** ou outra tecla, e ela funciona de verdade. A tecla agora é guardada pelo código físico (independente de layout/teclado), então se adapta a qualquer máquina.
- Quem já tinha escolhido AltGr e não disparava passa a funcionar **sem recadastrar** (o valor antigo é corrigido sozinho).
- Onboarding e tela inicial mostram a tecla com nome amigável ("AltGr", "Ctrl direito"...).

## [0.1.7] — 2026-05-29

### Adicionado
- **Modo travado (lock) na hotkey.** Dois toques rápidos em `Right Ctrl` (até 350 ms entre eles) travam a gravação. Qualquer toque depois encerra. Hold tradicional continua funcionando igual (push-to-talk). Útil pra ideias mais longas sem ter que segurar a tecla.
- **Cap de gravação de 60 segundos.** A gravação encerra sozinha ao bater 60 s, em qualquer modo (push-to-talk ou lock). Evita upload de áudios gigantes pra API e protege custo / latência. Barra de progresso fina na base do overlay vira amber nos últimos 10 s pra avisar.
- Indicador "lock" no canto superior direito do overlay quando a gravação está travada.

### Mudado
- Site oficial: contraste do rodapé melhorado (legível em monitores comuns).
- Site oficial: páginas internas de Privacidade, Termos, Licença MIT e Changelog.
- Copy do site e do README sem em-dash, pra leitura mais natural.

## [0.1.6] — 2026-05-29

### Mudado
- UI labels do app refletem versão real (TopBar + Sobre).

### Refatorado
- Versão centralizada em `site/lib/version.ts` e `renderer/shared/lib/app-version.ts`.

### Adicionado
- Assinatura "Desenvolvido por Matheus Machado" no rodapé do site.
- Separador de título padronizado em pipe (`|`) em vez de em-dash, em SEO/OG.

## [0.1.5]

### Corrigido
- Waveform do overlay reflete RMS real do microfone (zero animação cenográfica quando o mic está mudo).

## [0.1.4]

### Corrigido
- Filtro "App" do histórico vira chips. Selecionar "Todos" volta sempre ao estado base.

## [0.1.3]

### Mudado
- Biblioteca de ícones SVG outline substitui todos os emojis no app.

## [0.1.2]

### Corrigido
- Histórico vazio quando não havia gravação.
- Edição só-label de slot.
- Limpeza do test-transcribe.

## [0.1.1]

### Adicionado
- Pipeline completo: hotkey → record → STT → inject → history conectado fim-a-fim.

## [0.1.0]

### Adicionado
- Release inicial. Hotkey global `Right Ctrl`, overlay always-on-top, transcrição via Groq Whisper Large v3 Turbo + fallback faster-whisper local, paste universal em qualquer app, histórico SQLite + FTS5, vocabulário custom.
