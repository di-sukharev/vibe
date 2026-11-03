import { createServer } from 'node:net'
import { defineConfig, devices } from '@playwright/test'

// Workers load this file again; the environment keeps them on the port the runner chose.
process.env.E2E_WEBSITE_PORT ??= String(await new Promise<number>((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => {
      if (typeof address === 'object' && address) resolve(address.port)
      else reject(new Error('No free website test port'))
    })
  })
}))
const websitePort = Number(process.env.E2E_WEBSITE_PORT)
const websiteUrl = `http://127.0.0.1:${websitePort}`

export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './e2e/.artifacts/results',
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    channel: 'chrome',
    launchOptions: { chromiumSandbox: true },
    ...devices['Desktop Chrome'],
    baseURL: websiteUrl,
    reducedMotion: 'no-preference',
  },
  webServer: {
    command: `bun run build && bun run preview --host 127.0.0.1 --port ${websitePort} --strictPort`,
    url: websiteUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
