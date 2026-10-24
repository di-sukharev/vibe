import { fileURLToPath } from 'node:url'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  plugins: [reactRouter(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Bundle used icons so the SPA shell does not load the full icon catalog in Node.
  ssr: { noExternal: command === 'build' ? ['@hugeicons/core-free-icons'] : [] },
  // Crawl lazy route imports before the first page loads to avoid stale optimized dependencies.
  optimizeDeps: { entries: ['src/root.tsx', 'src/routes/**/*.tsx'] },
  server: { port: 5173 },
}))
