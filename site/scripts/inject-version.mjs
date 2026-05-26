// Post-build: carimba ?v=<COMMIT_SHA[:8]> em todas as refs de assets dentro do dist/.
// Astro já hash-eia os arquivos (cache-busting natural), mas o ?v=<sha> dá uma
// dimensão extra (debug + audit de build em prod) — lição feedback_asset_versioning_estatico.
//
// COMMIT_SHA vem de:
//   1. CF Pages: env CF_PAGES_COMMIT_SHA
//   2. GitHub Actions / Vercel: env GITHUB_SHA / VERCEL_GIT_COMMIT_SHA
//   3. Local build: git rev-parse HEAD
//   4. Fallback: timestamp em hex (8 chars)

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const DIST = resolve(process.cwd(), "dist");

function resolveCommitSha() {
  const fromEnv =
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv.slice(0, 8);

  try {
    const sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (sha) return sha.slice(0, 8);
  } catch {
    // fora de repo git
  }

  return Date.now().toString(16).slice(-8);
}

const sha = resolveCommitSha();

console.log(`[inject-version] applying ?v=${sha} to /_a/* assets in ${DIST}`);

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (/\.(html|xml|txt)$/i.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

let exists = true;
try {
  await stat(DIST);
} catch {
  exists = false;
}

if (!exists) {
  console.error(`[inject-version] dist/ não encontrado em ${DIST}. Rode "astro build" antes.`);
  process.exit(0); // não bloquear pipeline
}

const files = await walk(DIST);
let modified = 0;

// Regex: encaixa em src/href que apontem pra /_a/... sem query string,
// terminando em .css ou .js. Adiciona ?v=<sha>.
const PATTERN = /(["'])(\/_a\/[^"']+?\.(?:css|js|mjs))(\1)/g;

for (const file of files) {
  const original = await readFile(file, "utf8");
  let touched = original.replace(PATTERN, (_m, q1, path) => `${q1}${path}?v=${sha}${q1}`);

  // Substitui placeholder do BaseLayout (__COMMIT_SHA__) também.
  if (touched.includes("__COMMIT_SHA__")) {
    touched = touched.split("__COMMIT_SHA__").join(sha);
  }

  if (touched !== original) {
    await writeFile(file, touched, "utf8");
    modified += 1;
  }
}

console.log(`[inject-version] done. ${modified} file(s) modified. build=${sha}`);
