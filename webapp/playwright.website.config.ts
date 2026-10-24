import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

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
  testDir: './e2e/website',
  outputDir: './e2e/.artifacts/website-results',
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: websiteUrl,
    reducedMotion: 'no-preference',
  },
  webServer: {
    command: `bun run build && bun run preview --host 127.0.0.1 --port ${websitePort} --strictPort`,
    cwd: fileURLToPath(new URL('../website', import.meta.url)),
    url: websiteUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
