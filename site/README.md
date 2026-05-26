# flowtype site

Marketing site estático do flowtype — Astro 5 + Tailwind 4, deployable em
Cloudflare Pages (free).

```bash
npm install
npm run dev        # http://127.0.0.1:4321
npm run build      # gera dist/ + carimba ?v=<commit_sha> em assets
npm run preview    # serve dist/
```

Deploy: ver [`DEPLOY.md`](DEPLOY.md).
Design tokens: [`projects/flowtype/architecture/design-spec.md`](../architecture/design-spec.md).
Owner do WO-7: Bruna (designer so-testar).

## Stack

- **Astro 5** SSG (zero JS por padrão, islands só onde precisa)
- **Tailwind 4** via `@astrojs/tailwind`
- **Fonts self-hosted** via `@fontsource-variable/{inter,jetbrains-mono}` (zero CDN externa)
- **Icons** SVG inline (sem pacote externo pesado)
- **Sitemap** auto via `@astrojs/sitemap`
- **Headers de segurança** estáticos em `public/_headers` + reforço em
  `functions/_middleware.ts` (CF Pages Function)
- **Asset versioning** via `scripts/inject-version.mjs` (`?v=<COMMIT_SHA[:8]>`)

## Estrutura

```
site/
├─ public/             # assets servidos as-is
│  ├─ favicon.svg
│  ├─ og-image.svg     # 1200x630 social preview
│  ├─ _headers         # CF Pages: CSP, HSTS, cache
│  ├─ _redirects       # CF Pages: bloqueia /admin, /.env, /.git
│  └─ screenshots/     # PNGs do overlay (de .studio/screenshots/flowtype/)
├─ src/
│  ├─ layouts/BaseLayout.astro    # html/head/meta/og/schema-org
│  ├─ components/
│  │  ├─ Header.astro
│  │  ├─ Hero.astro
│  │  ├─ HowItWorks.astro
│  │  ├─ CompareTable.astro       # vs Wispr (table desktop / cards mobile)
│  │  ├─ FeaturesGrid.astro       # 10 cards
│  │  ├─ ScreenshotsSection.astro # 4 estados do overlay
│  │  ├─ DownloadCTA.astro        # .exe + checksum copyable
│  │  ├─ FAQ.astro                # 10 perguntas + FAQPage JSON-LD
│  │  ├─ Footer.astro
│  │  └─ icons/                   # Logo.astro + Icon.astro (SVG inline)
│  ├─ pages/
│  │  ├─ index.astro
│  │  └─ robots.txt.ts
│  └─ styles/global.css
├─ scripts/inject-version.mjs     # post-build: ?v=<commit_sha>
├─ functions/_middleware.ts       # CF Pages: reforço de headers em runtime
├─ astro.config.mjs
├─ tailwind.config.mjs
├─ tsconfig.json
├─ wrangler.toml                  # CF Pages CLI config
├─ DEPLOY.md
└─ README.md
```

## Performance / SEO

- HTML semântico: `<header>`, `<main>`, `<section>`, `<article>`, `<footer>`, `<nav>`, único `<h1>`
- Skip-to-content link (a11y)
- Meta description única, OG + Twitter cards, sitemap.xml auto
- JSON-LD `SoftwareApplication` (no `BaseLayout`) e `FAQPage` (no `FAQ.astro`)
- `prefers-reduced-motion` desativa pulses/shimmers
- Lazy images (`loading="lazy"`, `decoding="async"`, width/height inline)
- Preload da fonte Inter Variable
- Inline CSS automático em `_a/*.css` quando pequeno (Astro `inlineStylesheets: "auto"`)
- Zero JS framework — só 2 islands inline pequenos (FAQ accordion + copy-SHA)

## Trade-offs / desvios documentados

- **OG image como SVG, não PNG 1200x630.** SVG é leve, escalável, e quase todas
  redes sociais aceitam (Twitter / Facebook / LinkedIn convertem internamente).
  Owner pode regenerar como PNG real depois (export do SVG via Figma / Inkscape).
- **Repo GitHub e URL `flowtype.app` são placeholders.** Atualizar conforme
  registrado pelo owner — checklist em `DEPLOY.md`.
- **Download `.exe` aponta pra `/download/*` placeholder.** Roberto vai
  substituir pela URL real do release no WO-8.
- **`screenshots/` usa por ora os PNGs `wo1-overlay-*` do WO-1.** Quando WO-4
  implementar a UI real com paleta cyan, substituir só os arquivos (mesmos paths).

## Universo CR-1 (multi-key Groq)

A seção "Pool de 3 keys Groq" no FeaturesGrid e a linha "STT engine" na
CompareTable reforçam o diferencial chave introduzido pelo CR-1 (3 slots round-robin =
43.2k req/dia grátis). FAQ tem pergunta dedicada sobre como adicionar mais keys.
