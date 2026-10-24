import { fileURLToPath } from 'node:url'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { resolvePublicWebappUrl } from './src/lib/landing-actions.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  resolvePublicWebappUrl(env.VITE_WEBAPP_URL)

  return {
    plugins: [reactRouter(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // Framework route modules replace Vite's default HTML entry for dependency discovery.
    optimizeDeps: { entries: ['src/root.tsx', 'src/routes/**/*.tsx'] },
    server: { port: 4321 },
  }
})
