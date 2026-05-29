import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { applyE2ePortEnv, resolveE2ePorts } from './ports'

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
const portPlan = await resolveE2ePorts()
applyE2ePortEnv(portPlan)

export default defineConfig({
  testDir: './specs',
  testMatch: 'typography-primitives.spec.ts',
  outputDir: './.artifacts/typography-results',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: portPlan.webUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    name: 'web',
    command: `bun run dev --host 127.0.0.1 --port ${portPlan.webPort}`,
    cwd: frontendRoot,
    env: {
      ...process.env,
      VITE_API_URL: portPlan.backendUrl,
    },
    url: portPlan.webUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
