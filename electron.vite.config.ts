import { resolve } from 'node:path'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Copia src/main/db/migrations/*.sql pra out/main/migrations no closeBundle.
function copyMigrationsPlugin() {
  return {
    name: 'flowtype-copy-migrations',
    apply: 'build' as const,
    closeBundle() {
      const src = resolve('src/main/db/migrations')
      const dst = resolve('out/main/migrations')
      if (!existsSync(src)) return
      if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
      cpSync(src, dst, { recursive: true })
    }
  }
}

/**
 * Drops a `package.json` with `{"type":"commonjs"}` into out/ so the CJS
 * bundles produced by Rollup are loaded as CJS by Node 20+/Electron 31
 * regardless of the project-level `"type": "module"`. Without this, the
 * `require()` calls emitted by Rollup fail with "require is not defined
 * in ES module scope" when Electron tries to execute out/main/index.js.
 *
 * The `main` field MUST be omitted here — if present, Electron treats the
 * out/ directory as the app root and resolves it in Node-only mode for
 * some entry-path combinations. Leaving it off forces Electron to read the
 * project root's package.json (which points to ./out/main/index.js) and
 * boots the Chromium main process correctly.
 */
function markOutAsCjsPlugin() {
  return {
    name: 'flowtype-mark-out-cjs',
    apply: 'build' as const,
    closeBundle() {
      const out = resolve('out')
      if (!existsSync(out)) mkdirSync(out, { recursive: true })
      writeFileSync(
        resolve(out, 'package.json'),
        JSON.stringify({ type: 'commonjs' }, null, 2),
        'utf-8'
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyMigrationsPlugin(), markOutAsCjsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve('src/preload/main.ts'),
          overlay: resolve('src/preload/overlay.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          main: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html')
        }
      }
    }
  }
})
