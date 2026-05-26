# flowtype site — Deploy Cloudflare Pages

> v0.1.0 · WO-7 (Bruna) · 2026-05-25

Site estático Astro pronto pra deploy em Cloudflare Pages. Free, sem
config exótica, HTTPS automático, CSP/HSTS via [`public/_headers`](public/_headers).

---

## Build local

```bash
cd projects/flowtype/site
npm install
npm run build       # gera dist/ + carimba ?v=<commit_sha> em assets
npm run preview     # serve dist/ em http://127.0.0.1:4321
```

Output em [`dist/`](dist/). Pronto pra qualquer host estático (CF Pages, Netlify,
S3+CloudFront, etc.).

---

## Deploy CF Pages — caminho recomendado (Git auto-deploy)

1. Sobe o repo pro GitHub/GitLab (já está no monorepo `so_testar` — pode usar subpath).
2. Dashboard CF Pages: **Workers & Pages → Create → Pages → Connect to Git**.
3. Configura:

   | Campo                    | Valor                          |
   | ------------------------ | ------------------------------ |
   | Project name             | `flowtype`                     |
   | Production branch        | `main`                         |
   | Framework preset         | `Astro`                        |
   | Build command            | `npm run build`                |
   | Build output directory   | `dist`                         |
   | Root directory (advanced)| `projects/flowtype/site`       |
   | Node version             | `20`                           |

4. CF Pages preenche `CF_PAGES_COMMIT_SHA` automaticamente — o script
   [`scripts/inject-version.mjs`](scripts/inject-version.mjs) lê e carimba em assets.
5. Cada push em `main` dispara build + deploy. Previews automáticos por PR.

---

## Deploy via Wrangler CLI (alternativa)

```bash
# Uma vez:
npm install -g wrangler
wrangler login

# A cada deploy:
cd projects/flowtype/site
npm run build
wrangler pages deploy dist --project-name=flowtype --branch=main
```

---

## Domínio custom (`flowtype.app`)

1. Compra o domínio (Cloudflare Registrar / Namecheap / Registro.br — owner decide).
2. CF Pages → projeto `flowtype` → **Custom domains → Set up a custom domain**.
3. Adiciona `flowtype.app` e `www.flowtype.app`.
4. Se o domínio já está no Cloudflare DNS, é 1-click. Se não, CF mostra os CNAMEs
   pra apontar no registrar.
5. SSL ativa em ~2 min (Universal SSL grátis).

---

## Headers de segurança aplicados

Via [`public/_headers`](public/_headers) (CF Pages serve estaticamente) + reforço
em [`functions/_middleware.ts`](functions/_middleware.ts):

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()…`
- `Content-Security-Policy` strict (`default-src 'self'`)
- HSTS preload requer 1+ ano em produção antes de submeter em hstspreload.org

[`public/_redirects`](public/_redirects) bloqueia paths sensíveis (`/admin/*`,
`/.env`, `/.git/*`) com 404.

---

## Cache strategy

- HTML / sitemap / robots: `max-age=0, must-revalidate` (ETag → 304)
- Assets Astro `/_a/*` (com hash): `max-age=31536000, immutable`
- Imagens/screenshots: `max-age=86400, must-revalidate`

Resultado: visitante recorrente faz só 1 HEAD/304 no HTML; CSS/JS vêm 100% do
cache do browser até o próximo deploy (que muda o hash).

---

## Asset versioning

[`scripts/inject-version.mjs`](scripts/inject-version.mjs) roda pós `astro build`
e carimba `?v=<commit_sha[:8]>` em todas as refs `/_a/*.css|js` dentro de `dist/`.
Lição [`feedback_asset_versioning_estatico`].

Em CF Pages: lê `CF_PAGES_COMMIT_SHA` (env auto-injetada).
Local: lê `git rev-parse HEAD`.
Fallback: timestamp hex.

---

## Lighthouse local

```bash
npm run preview     # em outro terminal
# abrir Chrome DevTools → Lighthouse → Analyze
```

Alvo: 95+ em Performance, Accessibility, Best Practices, SEO.

---

## Trocar URLs placeholder antes do release

Antes do owner fazer push pra prod, atualizar:

| Arquivo                                              | Placeholder atual                                              | Substituir por                              |
| ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `src/components/DownloadCTA.astro`                   | `/download/flowtype-setup-v0.1.0.exe`                          | URL do release GitHub Roberto (WO-8)        |
| `src/components/DownloadCTA.astro`                   | `PENDING_SHA256_WO8_RELEASE_BUILD…`                            | SHA-256 real do .exe                        |
| `src/components/Header.astro` / `Footer.astro` / FAQ | `https://github.com/flowtypeapp/flowtype`                      | Repo público real                           |
| `astro.config.mjs`                                   | `site: "https://flowtype.app"`                                 | Domínio final (mantém se for `flowtype.app`) |

---

## Prompt pro Claude Chrome (relay de deploy CF Pages + DNS)

Cola o bloco abaixo numa janela do Chrome com Claude:

````text
Você vai configurar o deploy do site flowtype no Cloudflare Pages.

Pré-requisitos (preciso confirmar comigo antes):
- [ ] Tenho conta Cloudflare (mesmo email da Hetzner / Coolify? confirma)
- [ ] O repo está no GitHub? Qual a URL? (ex.: github.com/<user>/so_testar)
- [ ] Já comprei o domínio flowtype.app? Em qual registrar? (CF / Namecheap / Registro.br)

Passo a passo no painel Cloudflare:

1. Workers & Pages → Create → Pages → "Connect to Git"
2. Autoriza o GitHub (se ainda não autorizou)
3. Seleciona o repo `so_testar`
4. Branch de produção: `main`
5. Configurações de build (clica em "advanced"):
   - Framework preset: Astro
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `projects/flowtype/site`
   - Node version: `20`
6. Deploy → aguarda 1-2 min → tira print do build log
7. Quando concluir, anota a URL `*.pages.dev` que o CF gerou
8. Se o owner já tem flowtype.app:
   - Custom domains → "Set up a custom domain" → `flowtype.app`
   - Se o domínio está no CF: 1-click
   - Se está em outro registrar: CF mostra CNAMEs — preciso colar aqui pra eu mandar pro owner
9. Aguarda SSL ficar verde (~2 min)
10. Tira print da URL final funcionando com cadeado HTTPS

Me retorne:
- URL temporária .pages.dev
- Print do build log
- (Se aplicável) CNAMEs pro registrar do domínio
- URL final HTTPS funcionando
````

---

## Verificação pós-deploy (checklist)

- [ ] Visita URL → carrega em < 2s, sem flash branco
- [ ] DevTools → Network → CSS tem `?v=<sha>` no nome
- [ ] DevTools → Network → response headers do CSS tem `Cache-Control: max-age=31536000, immutable`
- [ ] DevTools → Network → response headers do `/` tem `Cache-Control: max-age=0, must-revalidate`
- [ ] DevTools → Application → Security → HTTPS válido
- [ ] `curl -I https://flowtype.app | grep -i security` → todos headers presentes
- [ ] Lighthouse mobile → ≥ 95 em todas categorias
- [ ] FAQ accordion abre/fecha; só 1 aberto por vez
- [ ] Botão "Baixar para Windows" link existe (URL real será preenchida no WO-8)
- [ ] OG image carrega (`https://flowtype.app/og-image.svg`)
- [ ] `flowtype.app/admin` → 404
- [ ] `flowtype.app/.env` → 404
