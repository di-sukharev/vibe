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
  AUTH_RATE_LIMIT_MAX: process.env.E2E_AUTH_RATE_LIMIT_MAX ?? '120',
  // Keeps filesystem-driver uploads inside the run's artifacts instead of accumulating in
  // backend/.storage.
  PRIVATE_STORAGE_LOCAL_ROOT: resolve(frontendRoot, 'e2e/.artifacts/storage'),
  ...storageEnv(),
})

/**
 * Pins every storage setting that decides which backend this run uses and where its uploads go.
 *
 * The backend child loads `backend/.env` for anything the environment does not set, so leaving
 * these open would let a developer's file decide which driver the E2E exercises - silently
 * turning `bun run e2e:webapp` into a second S3 run, or, with real credentials in `.env`,
 * writing test avatars into a real bucket. `bun run e2e:webapp:s3` sets the group in
 * `process.env`, and that is the only way this run talks to S3.
 *
 * The size and TTL bounds are deliberately left inherited: they cannot redirect an upload
 * anywhere, and a value too small for the fixtures fails loudly rather than silently elsewhere.
 */
function storageEnv() {
  if (process.env.PRIVATE_STORAGE_DRIVER === 's3') return {}

  // Blank rather than absent: the env schema treats an empty string as unset, so this overrides
  // `.env` without tripping the "set but the driver is filesystem" startup error. The two
  // booleans get a literal value instead, because their schema rejects an empty string.
  return {
    PRIVATE_STORAGE_DRIVER: 'filesystem',
    // Where the filesystem driver's signed URLs point. Blank falls back to the run's own PORT,
    // which is pinned above; inheriting it would send uploads at whatever host `.env` names.
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: '',
    PRIVATE_STORAGE_REGION: '',
    PRIVATE_STORAGE_BUCKET: '',
    PRIVATE_STORAGE_ENDPOINT: '',
    PRIVATE_STORAGE_ACCESS_KEY_ID: '',
    PRIVATE_STORAGE_SECRET_ACCESS_KEY: '',
    PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false',
    PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'false',
  }
}

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
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.artifacts/report' }]],
  use: {
    baseURL: frontendUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
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
