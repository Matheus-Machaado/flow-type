# flowtype — Design Spec v1 (Bruna)

> **Missão:** MIS-0024
> **Autor:** Bruna (designer so-testar)
> **Data:** 2026-05-25
> **Companion artefato:** [`projects/flowtype/design/bruna-v1/prototype/index.html`](../design/bruna-v1/prototype/index.html) (clicável via file://)

---

## 1. Identidade & princípios

**flowtype é silêncio até você falar.** O produto vive no canto da tela como uma presença discreta; só ganha massa visual quando captura voz. A janela principal nem existe pro usuário — Settings e Histórico abrem on-demand e fecham. O overlay é o produto.

Três princípios não-negociáveis:

1. **Voz first, UI quase invisível** — nenhuma confirmação modal cega; o overlay sempre diz o que está acontecendo (idle → armed → capturing → processing). Latência percebida importa mais que controles ricos.
2. **Dark minimalista com acento cromo-elétrico** — preto profundo + cinza grafite + um único accent (cyan-elétrico `#5FE6FF`) que sugere o fluxo de voz virando texto. Sem ruído visual, sem gradientes barrocos. Slim, técnico, premium.
3. **Multi-key como cidadão de primeira classe** — `<GroqSlotManager />` é a peça-chave do CR-1: 3 cards horizontais, status badge colorido, usage bar, validação live. Reutilizado idêntico em Settings e Onboarding.

---

## 2. Paleta de cores (CSS vars)

```css
:root {
  /* Background graduais */
  --bg-0:           #060708;   /* root, body */
  --bg-1:           #0c0e11;   /* main surfaces */
  --bg-2:           #14171c;   /* cards, drawer rows */
  --surface:        #1a1e25;   /* elevated panels (modals, popovers) */
  --surface-hi:     #232830;   /* hover/active row */

  /* Accent — cyan elétrico (voz↔texto fluindo) */
  --accent:         #5FE6FF;   /* primário: links, badges, focus */
  --accent-2:       #B8FFEE;   /* secundário: highlights, glow */
  --accent-deep:    #1A8FA8;   /* hover/pressed accent */
  --accent-glow:    rgba(95, 230, 255, 0.18);

  /* Slots Groq — cromáticos distintos */
  --slot-1:         #5FE6FF;   /* cyan */
  --slot-2:         #7DD3FC;   /* sky */
  --slot-3:         #A5B4FC;   /* indigo soft */
  --slot-local:     #FBBF24;   /* amber — destaca fallback */

  /* Tipografia */
  --text-primary:   #E8ECEF;
  --text-secondary: #B5BCC4;
  --text-muted:     #7C8590;
  --text-faint:     #4A525C;
  --text-on-accent: #051820;

  /* Estados semânticos */
  --success:        #34D399;
  --success-bg:     rgba(52, 211, 153, 0.10);
  --warning:        #FBBF24;
  --warning-bg:     rgba(251, 191, 36, 0.10);
  --danger:         #F87171;
  --danger-bg:      rgba(248, 113, 113, 0.10);
  --info:           #60A5FA;

  /* Bordas */
  --border:         #1f242c;
  --border-strong:  #2c333d;
  --border-accent:  rgba(95, 230, 255, 0.35);

  /* Sombras */
  --shadow-sm:      0 1px 2px rgba(0, 0, 0, 0.6);
  --shadow-md:      0 4px 16px rgba(0, 0, 0, 0.55);
  --shadow-overlay: 0 8px 32px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(95, 230, 255, 0.08);
  --shadow-glow:    0 0 24px var(--accent-glow);
}
```

**Por que cyan elétrico (`#5FE6FF`)?** Wispr Flow usa azul corporativo morno. flowtype precisa parecer **rápido** — cyan elétrico é a cor que cérebros associam a "energia digital fluindo" (waveform, sinal de transmissão, sci-fi). Contrasta WCAG AAA contra `--bg-0`. Diferencia visualmente do playspeak (gold/náutico) — produtos do mesmo studio com identidades próprias.

---

## 3. Tipografia

- **Sans (UI):** `Inter` (400/500/600/700) — neutra, legível em sizes pequenos, default Windows-friendly via system fallback.
- **Mono (códigos, keys, hotkeys):** `JetBrains Mono` (400/500) — disambigua `0`/`O`, `1`/`l`.
- **Display (site marketing apenas):** `Inter Display` ou `Geist` — h1 heavy weight 700.

### Scale

| Token | Size | Line-height | Uso |
|---|---|---|---|
| `text-xs` | 11px | 14px | meta linhas, badges pequenos, timestamps |
| `text-sm` | 13px | 18px | body padrão (overlay, settings labels) |
| `text-base` | 14px | 20px | títulos de seção (Settings) |
| `text-lg` | 16px | 22px | h2 (modals, wizard steps) |
| `text-xl` | 20px | 26px | h1 windows (Settings, Histórico) |
| `text-2xl` | 28px | 34px | h1 onboarding |
| `text-display` | 48px | 54px | site hero h1 |

**Weights default:** body 400, label/meta 500, button/h 600, h1 700.

---

## 4. Componentes (≥14)

### 4.1 OverlayWidget (4 estados)

Janela transparente 200x64px, sempre no canto inferior direito. Border-radius 12px, glass effect sutil. Estado controlado via IPC `overlay:state`.

```
┌────────────────────────────┐
│  ●                         │   idle    — dot 8px breathing
│  ◉ hold to record          │   armed   — pulse cyan, label
│  ▌▌▌▌▌  capturing 1.2s     │   captur. — waveform live + duration
│  ◐ transcrevendo…          │   process — spinner + status text
└────────────────────────────┘
```

Estados detalhados:

| Estado | Visual | Opacidade default | Hot-corner reveal | Aria-live |
|---|---|---|---|---|
| `idle` | dot 8px `--text-muted` breathing (opacity 0.3↔0.6, 2s) | 0.3 | 1.0 | off |
| `armed` | dot 12px `--accent`, halo pulse rápido (scale 1→1.4, 600ms) | 1.0 | 1.0 | polite |
| `capturing` | 5 wave bars `--accent` reativas ao mic (30fps), label "capturing Xs" | 1.0 | 1.0 | polite |
| `processing` | spinner 14px rotativo `--accent`, label `ouvindo… → transcrevendo… → colando…` | 1.0 | 1.0 | polite |

Pós-paste: badge transitório `☁ Groq #N · 720ms` por 1500ms (fade-in 150ms / fade-out 300ms).

### 4.2 GroqSlotCard

Card 1 dos 3 do `<GroqSlotManager />`. 4 sub-estados:

| Sub-estado | Visual | Ações |
|---|---|---|
| `empty` | ícone `+` 32px cinza, texto "Adicionar key Groq" | Click → expande form inline (paste key + label + daily_cap select) |
| `valid` (online) | label editável, mask `gsk_…XXXX`, badge **● online** verde, usage bar `1.2k / 14.4k req · 8%` | Testar · Editar · Remover |
| `invalid` | mesma estrutura, badge **● invalid** vermelho, mensagem inline "Key rejeitada — re-validar" | Re-validar · Substituir · Remover |
| `exhausted` | badge **● exhausted hoje** amber, usage bar full vermelho `14.4k / 14.4k`, texto "Reset em 04h22m" | Aguardar · Substituir · Remover |

Cores: badge dot 8px com glow leve do mesmo tom; usage bar 4px altura, fill gradiente do `--slot-N`.

### 4.3 GroqSlotManager (composto)

Wrapper que renderiza 3 `GroqSlotCard` horizontais + header consolidado:

```
2 de 3 slots ativos · 8.4k de 43.2k req disponíveis hoje
┌──────────────┬──────────────┬──────────────┐
│ Slot #1 valid│ Slot #2 valid│ Slot #3 empty│
└──────────────┴──────────────┴──────────────┘
```

Props: `{ pool, mode: 'full' | 'compact', onPoolChange }`. Modo compact (onboarding) só mostra slot #1 + "+1 ou +2 keys depois nas Settings".

Empty-state global (0 slots): alert amber acima dos cards, deep-link `console.groq.com` em mono pill.

### 4.4 SettingsSection

Layout vertical, padding 24px, divider `--border` entre seções. Cada controle salva sozinho (sem botão Save global) — toast inferior `Salvo` 1s, opacity decay.

```
┌───────────────────────────────────────────────┐
│ Microfone                          [seção 2/7]│
│ ──────────────────────────────────────────── │
│ Dispositivo                                   │
│ [▼ Realtek Audio (default)            ]       │
│                                               │
│ Nível de input                                │
│ ▌▌▌▌▌▌▌▌░░░░░░░ -12 dB                       │
│                                               │
│ Pausa automática se silêncio > 800ms          │
│ [ON ●]                                        │
└───────────────────────────────────────────────┘
```

### 4.5 HotkeyCapture

Input live que captura combo enquanto pressionada. Estados:

- **idle:** mostra valor atual em pill mono (`Right Ctrl` ou `Ctrl+Shift+Space`)
- **capturing:** pill pulsa cyan, label "pressione a tecla…"
- **detected:** pill verde com tecla nova, botões `Salvar` / `Cancelar`
- **conflict:** pill amber, "Esta tecla é usada por X — escolha outra"

```
Hotkey de gravação
[Right Ctrl ⚡]  [Mudar]
```

### 4.6 MicDevicePicker

Dropdown custom dark com 3 elementos por device:

- ícone (built-in / USB / bluetooth)
- nome do device
- meter live mini (5 barras)

Default-tag em verde no item selecionado.

### 4.7 LanguageDropdown

Dropdown com `Auto-detectar (✦)` no topo + lista PT-BR, EN-US, ES, FR, DE, IT. Cada idioma tem flag emoji + code mono.

### 4.8 VocabRow (correção pós-transcrição)

Linha editável da tabela `Vocabulário Custom`:

```
┌─────────────────┬───────────────┬──────┬──────────────┐
│ kunha           │ Cunha         │ ☐ Aa │ ⚙ global   ×│
└─────────────────┴───────────────┴──────┴──────────────┘
       ↑                ↑           ↑        ↑          ↑
   term_wrong      term_correct   case   scope chip  remove
```

Scope chip: `global` (cyan), `<exe-name>` (sky com ícone do app). Click no chip troca scope. `+` no rodapé adiciona row vazia.

### 4.9 HistoryItem

Item da timeline reversa (640px window):

```
┌────────────────────────────────────────────────────────────┐
│ há 2 min · claude.exe · "Claude — chat"          ☁ #1 720ms│
│ ────────────────────────────────────────────────────────── │
│ "Preciso refatorar o módulo de autenticação pra usar JWT  │
│ stateless e remover a tabela sessions do schema."         │
│                                                            │
│ ▶ 00:00 / 00:04   ✎ editar   ⎘ copiar   ⤓ exportar   🗑   │
└────────────────────────────────────────────────────────────┘
```

Estados: default, hover (subtle bg `--surface-hi`), playing (▶→❚❚), editing (textarea inline + save/cancel), deleting (confirm inline com countdown 3s).

### 4.10 SearchBar (FTS5)

```
┌──────────────────────────────────────────────────┐
│ 🔍  reunião marcada                          [×] │
└──────────────────────────────────────────────────┘
       ↑ debounce 250ms → FTS5 MATCH
```

Resultados destacam o termo (`<mark>` com bg `--accent-glow`). Counter `15 resultados` abaixo da bar.

### 4.11 DateFilterChip / AppFilterChip

Chips horizontais scrolláveis abaixo da search:

```
[Hoje] [7d] [30d] [Tudo]   |   [📝 notepad ×] [💬 claude ×] [+ app]
```

Chip selecionado: bg `--accent`, text `--text-on-accent`. Não-selecionado: bg `--surface`, text `--text-secondary`, border `--border`.

### 4.12 ExportButton (dropdown md/json)

```
[⤓ Exportar ▾]
  ├─ Markdown (.md)
  ├─ JSON (.json)
  └─ ─── (separator) ───
     Respeita filtros atuais
```

Toast após save: `✓ Exportado para flowtype-2026-05-25.md`.

### 4.13 OnboardingStep (wizard frame)

Layout centrado 720x520, dot navigation no topo, conteúdo no meio, ações no rodapé:

```
┌────────────────────────────────────────────────────────┐
│   ● ─ ○ ─ ○ ─ ○                  Passo 1 de 4         │
│                                                        │
│              [conteúdo do step aqui]                   │
│                                                        │
│  ─────────────────────────────────────────────────────│
│   [← Voltar]                          [Pular] [Próximo→]│
└────────────────────────────────────────────────────────┘
```

Dots: ativo `--accent`, passados `--accent-deep`, futuros `--text-faint`. Transição entre steps: slide horizontal 220ms ease-out.

### 4.14 TestTranscriptionInline (gravar 3-5s + result)

Card que aparece dentro do wizard step 4 e do botão "testar" nas Settings:

```
┌──────────────────────────────────────────────────┐
│  🎙 Gravar 5s e testar                            │
│                                                  │
│  Estado: ● ouvindo… 03s                          │
│  ▌▌▌▌▌▌▌▌▌▌▌▌                                    │
│                                                  │
│  ────────── resultado ──────────                 │
│  "olá flowtype, isso é um teste de transcrição" │
│  ☁ Groq #1 · primary · 720ms · 0 erros          │
└──────────────────────────────────────────────────┘
```

Botão grande "Gravar 5s" com contador regressivo durante captura. Após resultado, CTA "Gravar de novo" + ação contextual ("Próximo passo →" no onboarding, "OK" nas Settings).

---

## 5. Animações (≥8 catalogadas)

| # | Nome | Trigger | Duração | Easing | FPS alvo | Notas |
|---|------|---------|---------|--------|----------|-------|
| 1 | `overlay-state-transition` | IPC `overlay:state` muda | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)` | 60 | Cross-fade entre estados; sem flicker |
| 2 | `mic-waveform-live` | estado `capturing` ativo | contínuo | linear | 30 | AnalyserNode.getByteFrequencyData → 5 barras (heights 4-24px) |
| 3 | `overlay-pulse-armed` | estado `armed` | 600ms loop | `ease-in-out` | 60 | scale 1↔1.4 + halo cyan expandindo |
| 4 | `idle-breathing` | estado `idle` | 2000ms loop | `ease-in-out` | 60 | opacity 0.3↔0.6 no dot |
| 5 | `badge-fade-in-out` | pós-transcrição | 150ms in + 1500ms hold + 300ms out | `ease-out` / `ease-in` | 60 | Badge "☁ Groq #N · XXXms" |
| 6 | `hot-corner-reveal` | cursor entra em retângulo 200x80 bottom-right | 200ms | `ease-out` | 60 | overlay opacity 0.3→1.0; reverso após 300ms fora |
| 7 | `vocab-correction-highlight` | substituição aplicada na transcrição mostrada no histórico | 800ms | `ease-out` | 60 | `<mark>` com bg `--accent-glow` fadeando |
| 8 | `settings-drawer-open` | click tray "Settings" | 250ms | `cubic-bezier(0.4, 0, 0.2, 1)` | 60 | slide-in lateral + fade backdrop 0→0.5 |
| 9 | `history-item-insertion` | nova transcrição confirmada | 320ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 60 | slide-down do topo + bg flash cyan 1x |
| 10 | `paste-confirmation-flash` | paste bem-sucedido em app externo | 400ms | `ease-out` | 60 | overlay borda inteira pisca cyan suave |
| 11 | `wizard-step-slide` | navegação entre passos onboarding | 220ms | `ease-out` | 60 | translateX 100% → 0 |
| 12 | `key-validation-spinner` | testando Groq key | contínuo até resposta | linear | 60 | rotação 360° no ícone do botão |

**Princípio:** todas as animações respeitam `prefers-reduced-motion: reduce` — fallback pra cross-fade simples 100ms ou nenhuma.

---

## 6. Estados explícitos por superfície

### Overlay
- `idle` · `armed` · `capturing` · `processing` · `error` (badge vermelho 2s "falha — clique pra ver") · `muted` (dot opacidade 0.15)

### Settings → STT
- `loading` (skeleton 3 cards cinzas)
- `empty` (0 slots + alert amber)
- `partial` (1-2 slots configurados + cards vazios + 0)
- `full` (3 slots configurados, todos online)
- `degraded` (≥1 slot invalid/exhausted, banner amarelo no topo da seção)
- `all-exhausted` (banner vermelho "Sem cota Groq hoje — usando fallback local")

### Histórico
- `loading` (skeleton timeline 5 itens cinzas)
- `empty-zero` (ilustração minimalista + texto "Nada transcrito ainda — segure Right Ctrl e fale")
- `empty-search` ("Nenhum resultado pra '<query>' — limpar busca?")
- `populated` (lista virtual)
- `error-db` (banner vermelho "Erro ao carregar — reabrir")

### Onboarding
- `step-1` welcome
- `step-2` mic (incluindo `denied` / `granted`)
- `step-3` hotkey (incluindo `capturing` / `conflict` / `verified`)
- `step-4` test (incluindo `idle` / `recording` / `transcribing` / `result-ok` / `result-error`)
- `complete` (fade-out wizard + first overlay reveal)

### Site marketing
- `loading-hero` (skeleton + LCP < 1500ms)
- `default`
- `download-initiated` (toast "Baixando flowtype-setup-v0.1.0.exe — 180MB")

---

## 7. A11y (WCAG AA mínimo)

- **Contraste:** texto primário `#E8ECEF` sobre `--bg-0` `#060708` = ratio **18.9:1** (AAA). Texto muted sobre surface = **6.8:1** (AA). Accent sobre bg = **8.4:1** (AAA).
- **Focus visible:** ring 2px `--accent` com offset 2px em todos os controles. NUNCA `outline: none` sem replacement.
- **Keyboard nav:** Tab order coerente (top-down, left-right). Esc fecha settings/histórico. `Ctrl+,` abre settings. `Ctrl+H` abre histórico.
- **Screen reader:** botões do histórico com aria-label (`"Reproduzir áudio de há 2 minutos, claude.exe"`). Overlay states emitem `aria-live="polite"` quando muda. Wizard steps anunciam `"Passo X de 4: <título>"`.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` desativa pulse/waveform → mostra texto estático "gravando 03s".
- **High contrast mode:** Windows HC respeita CSS forced-colors — borders viram `CanvasText`, accent vira `Highlight`.

---

## 8. Voz first

Nenhum modal de confirmação intercepta o fluxo. O overlay é a única fonte de feedback durante captura+paste. Notificações de sistema (Windows toast) só usadas pra eventos terminais fora-de-foco (ex: "app bloqueado pra paste", "Groq pool esgotado").

Confirmações destrutivas (`Remover slot`, `Deletar transcrição`) acontecem inline na superfície que originou — nunca em popup separado.

---

## 9. Site marketing (WO-7) — estilo + seções

Dark theme matching o app (mesma paleta, mesma tipografia). Asset versioning `?v=<COMMIT_SHA>` em todos os CSS/JS. Lighthouse target LCP < 1.5s.

### Seções (em ordem)

1. **Hero** — h1 display 48px "sua voz vira texto onde você estiver", CTA primário cyan "Baixar para Windows" + secundário fantasma "Ver como funciona".
2. **Como Funciona** — 3 cards lado a lado com micro-vídeos loop (mp4 < 500KB, autoplay muted loop playsinline). Passos: 1) Segure Right Ctrl, 2) Fale, 3) Texto aparece no campo ativo.
3. **Comparativo vs Wispr** — table 3-cols × 6+ linhas (preço, limite, STT, privacy, vocab, open source). Checkmarks verdes pro flowtype, X amber pro Wispr.
4. **Features grid** — 10 cards (4-col desktop / 2 tablet / 1 mobile). Cada card: ícone SVG 24px + h3 + 1-2 frases.
5. **Screenshots** — 3 imagens WebP < 200KB (overlay 4 estados em montagem, Settings, Histórico). Lightbox click-to-zoom.
6. **Download** — botão grande `.exe` + checksum SHA256 copyable + "Requer Windows 10+" + link secundário `.zip portable`.
7. **FAQ** — accordion 10 perguntas (privacy, Groq free, hardware, SmartScreen, Mac/Linux, vocab, offline, código fonte, telemetry, suporte). `<details>` nativo + schema.org/FAQPage JSON-LD.
8. **Footer** — 3 colunas (Produto · Recursos · Contato) + "© 2026 flowtype · Made for human voice".

### Cuidados de produção
- Imagens lazy-load + WebP
- Vídeos mp4 com `prefers-reduced-motion` fallback (img estático)
- Sem dev info exposta (lição feedback_no_dev_leaks_in_ui)
- Não assumir email do usuário em mailto — placeholder configurável

---

## 10. Decisões visuais relevantes (trade-offs)

| Decisão | Alternativa rejeitada | Por quê |
|---|---|---|
| Cyan elétrico `#5FE6FF` | Roxo (Wispr-like) ou verde (terminal-hacker) | Roxo = corporativo morno (Wispr já tem); verde = associado a terminal/coding, não a voz. Cyan = "energia digital fluindo", contrasta WCAG AAA e diferencia do playspeak gold |
| Overlay 200x64 horizontal | Quadrado 80x80 (estilo tray icon) | Quadrado não comporta o badge `☁ Groq #N · 720ms` legível. Horizontal preserva info densa em footprint pequeno |
| Settings 480x720 fixo (não redimensionável) | Resizable | Slim é parte da identidade. Conteúdo cabe em 480px sem rolagem horizontal. Resizable abre porta pra estados quebrados |
| Histórico 640x720 (mais largo que Settings) | Mesmo 480 | Timeline com timestamp+app+texto não cabe legível em 480. 640 é o menor que mantém leitura confortável |
| Sem cor primária para "danger CTAs" (remover slot, deletar) | Botões vermelhos | Identidade calma e técnica. Confirms ficam inline com countdown 3s + ícone aviso amber, não com flash vermelho que assusta |
| `<GroqSlotManager />` 3 cards SEMPRE visíveis (mesmo vazios) | Cards adicionáveis dinamicamente | Pool é fixo em 3 slots (decisão CR-1). Mostrar sempre os 3 ensina ao usuário que o limite é 3 e expõe espaço pra crescer |
| Onboarding wizard 4 passos fixos (sem skip exceto explícito) | Skippable a qualquer momento | Cada step desbloqueia coisa concreta (mic, hotkey, key). Pular cria estado órfão. Skip do step 4 só permitido se key já veio do bootstrap |
| Site dark mesmo (não light) | Toggle light/dark | Coerência com o app. Light mode adicionaria 30% de surface area de design pra v0.1 sem trazer conversão (público técnico-friendly) |

---

## 11. Checklist de polimento (perfeccionista)

Lição `feedback_perfectionist_visual_standard` — antes de QA aprovar visual:

- [ ] Nenhum pixel vazando overlay → conteúdo respeitando border-radius 12px
- [ ] Nenhum overflow horizontal em window 480px (Settings)
- [ ] Sombras de overlay não estourando fora da área visível
- [ ] Botões com `truncate` em labels longos (não estourando container)
- [ ] Focus ring visível em TODOS os controles (mesmo skeleton/loading)
- [ ] Dark mode HC do Windows não quebra
- [ ] Transições de estado overlay < 200ms (sem flicker entre idle→armed)
- [ ] Loading skeletons em todas superfícies async (histórico, validação key)
- [ ] Mensagens de erro contextuais (não modal de erro genérico)

---

## 12. Tokens / arquivo de design

Quando passar pro código (Neymar/Zico):

- Tailwind config: extend colors com tokens da seção 2 (`bg.0/1/2`, `accent`, `accent-2`, `slot.1/2/3`, etc).
- Fontes via Google Fonts (Inter + JetBrains Mono) — site CSP whitelist.
- Animações em CSS keyframes + Framer Motion para overlay state machine.
- `<GroqSlotManager />` em `src/renderer/components/settings/GroqSlotManager.tsx` — props `pool`, `mode`, `onPoolChange`.

---

**Próximo passo:** revisar protótipo HTML clicável em `projects/flowtype/design/bruna-v1/prototype/index.html` (file://). Owner aprova ou pede ajustes via CR.
