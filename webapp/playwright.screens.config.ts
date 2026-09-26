import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import e2eConfig from './playwright.config'

// `bun run screens`: the E2E stack (test database, backend, Vite) and the Astro website run a
// screenshot tour instead of the specs. Images land in e2e/.artifacts/screens. See docs/UI.md.

function freePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address ? resolvePort(address.port) : reject(new Error('No free port')),
      )
    })
  })
}

// Workers load this file again; the environment keeps them on the port the runner chose.
process.env.SCREENS_WEBSITE_PORT ??= String(await freePort())
const websiteUrl = `http://127.0.0.1:${process.env.SCREENS_WEBSITE_PORT}`
process.env.SCREENS_WEBSITE_URL = websiteUrl

const e2eServers = Array.isArray(e2eConfig.webServer) ? e2eConfig.webServer : []

export default defineConfig({
  ...e2eConfig,
  testDir: './e2e/screens',
  outputDir: './e2e/.artifacts/screens-results',
  reporter: 'list',
  use: { ...e2eConfig.use, screenshot: 'off', trace: 'off', video: 'off' },
  webServer: [
    ...e2eServers,
    {
      name: 'website',
      // Astro 7 moves `astro dev` to the background when it detects an AI agent. The runner needs a
      // foreground child of its own, separate from any dev server the developer already runs.
      command: `bun run dev --host 127.0.0.1 --port ${process.env.SCREENS_WEBSITE_PORT} --ignore-lock`,
      cwd: fileURLToPath(new URL('../website', import.meta.url)),
      env: Object.fromEntries(
        Object.entries({ ...process.env, ASTRO_DEV_BACKGROUND: '1' }).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
      url: websiteUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
