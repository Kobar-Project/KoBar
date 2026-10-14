import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// T-216: build flavor for the renderer (read via src/buildFlags.ts). `vite serve` (npm run dev) is always 'dev';
// `vite build` uses env KOBAR_FLAVOR ('store' | 'direct'), defaulting to 'direct'. The dist:* scripts (tools/dist.mjs) set KOBAR_FLAVOR.
function resolveRendererFlavor(command: 'build' | 'serve'): 'dev' | 'store' | 'direct' {
  if (command === 'serve') return 'dev'
  const fromEnv = process.env.KOBAR_FLAVOR
  if (fromEnv === undefined || fromEnv === '') return 'direct'
  if (fromEnv === 'store' || fromEnv === 'direct') return fromEnv
  throw new Error(`Invalid KOBAR_FLAVOR "${fromEnv}" (expected "store" or "direct")`)
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    __KOBAR_FLAVOR__: JSON.stringify(resolveRendererFlavor(command)),
  },
  build: {
    rollupOptions: {
      // Separate PiP entry (ARC-22) so the PiP window does not load the main app bundle.
      // T-605: the Settings window has its own entry too (no app store, no persist, no plugin host).
      input: {
        main: resolve(rootDir, 'index.html'),
        pip: resolve(rootDir, 'pip.html'),
        settings: resolve(rootDir, 'settings.html'),
      },
    },
  },
}))
