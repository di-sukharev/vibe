import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyE2ePortEnv, resolveE2ePorts } from './e2e/ports'

const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = resolve(frontendRoot, '..')
const backendRoot = resolve(repositoryRoot, 'backend')

const portPlan = await resolveE2ePorts()
applyE2ePortEnv(portPlan)

const backendPort = portPlan.backendPort
const frontendPort = portPlan.webPort
const backendUrl = portPlan.backendUrl
const frontendUrl = portPlan.webUrl
const databaseUrl = portPlan.databaseUrl

function normalizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

const backendEnv = normalizeEnv({
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(backendPort),
  DATABASE_URL: databaseUrl,
  JWT_SECRET:
    process.env.JWT_SECRET ?? 'web-e2e-secret-at-least-thirty-two-characters',
  CORS_ORIGINS: [frontendUrl, 'http://localhost:5173'].join(','),
  COOKIE_SECURE: 'false',
})

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  testDir: './e2e/specs',
  outputDir: './e2e/.artifacts/test-results',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.artifacts/report' }]],
  use: {
    baseURL: frontendUrl,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'backend',
      command: 'bun run start',
      cwd: backendRoot,
      env: backendEnv,
      url: `${backendUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'web',
      command: `bun run dev --host 127.0.0.1 --port ${frontendPort}`,
      cwd: frontendRoot,
      env: normalizeEnv({
        ...process.env,
        VITE_API_URL: backendUrl,
      }),
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
