import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import e2eConfig from './playwright.config'

// `bun run screens`: the E2E stack (test database, backend, Vite) and the public website run a
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

// Read by e2e/global-setup.ts (turns on the backend's DEV_SEED_DEMO fixtures) and by
// e2e/screens/screens.spec.ts (turns on the demo avatar fixture). Plain `bun run e2e:webapp`
// never sets this, so its specs keep today's two accounts.
process.env.SCREENS_SEED_DEMO = '1'

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
      command: `bun run dev --host 127.0.0.1 --port ${process.env.SCREENS_WEBSITE_PORT}`,
      cwd: fileURLToPath(new URL('../website', import.meta.url)),
      url: websiteUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
