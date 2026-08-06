import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { getConfig } from 'expo/config'

import { runMaestroPolicyAudit } from './maestro-policy-audit.mjs'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const mobileRoot = resolve(scriptDir, '../..')
const flowPath = resolve(mobileRoot, '.maestro/flows/auth-smoke.yaml')
const configPath = resolve(mobileRoot, '.maestro/config.yaml')
const reportsRoot = resolve(mobileRoot, '.maestro/reports')
const runId = new Date().toISOString().replace(/[^0-9]/g, '')
const reportDir = resolve(reportsRoot, runId)
const appConfigPath = resolve(mobileRoot, 'app.config.js')
const maestroMinimumVersion = process.env.MAESTRO_MIN_VERSION ?? '2.4.0'

const testIds = {
  DASHBOARD_ID: 'auth.dashboard',
  EMAIL_INPUT_ID: 'auth.email-input',
  LOGOUT_BUTTON_ID: 'auth.logout-button',
  NAME_INPUT_ID: 'auth.name-input',
  PASSWORD_INPUT_ID: 'auth.password-input',
  PASSWORD_VISIBILITY_BUTTON_ID: 'auth.password-visibility-button',
  PAYWALL_SCREEN_ID: 'paywall.screen',
  SUBMIT_BUTTON_ID: 'auth.submit-button',
}

runMaestroPolicyAudit()

const appConfig = readAppConfig()
const appId = process.env.MAESTRO_APP_ID ?? process.env.APP_ID ?? 'com.webappdemo.mobile'
const devServerUrl = requireDevServerUrl()
const devClientScheme =
  process.env.MAESTRO_DEV_CLIENT_SCHEME ?? defaultDevClientScheme(appConfig) ?? 'exp+mobile'
const devClientUrl = buildDevClientUrl(devClientScheme, devServerUrl)
const email =
  process.env.E2E_EMAIL ??
  `mobile-e2e-${runId}-${Math.random().toString(36).slice(2, 8)}@example.com`
const displayName = process.env.E2E_DISPLAY_NAME ?? 'Mobile E2E User'
const password = process.env.E2E_PASSWORD ?? 'password123'
const apiHealthUrl =
  process.env.E2E_API_HEALTH_URL ??
  (process.env.EXPO_PUBLIC_API_URL
    ? `${process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '')}/health`
    : undefined)
const metroStatusUrl = `${devServerUrl}/status`

function readAppConfig() {
  try {
    return { expo: getConfig(mobileRoot).exp }
  } catch (error) {
    process.stderr.write(`Failed to read ${appConfigPath}: ${error.message}\n`)
    process.exit(1)
  }
}

function defaultDevClientScheme(config) {
  const slug = config?.expo?.slug
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    return undefined
  }
  return `exp+${slug.trim()}`
}

function requireDevServerUrl() {
  const value = process.env.MAESTRO_DEV_SERVER_URL
  if (!value) {
    process.stderr.write(
      `${[
        'MAESTRO_DEV_SERVER_URL is required for Expo dev-client Maestro runs.',
        'Start Metro with a host-reachable URL, for example:',
        '  EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000 bunx expo start --dev-client --host lan --port 8081',
        'Then run:',
        '  EXPO_PUBLIC_E2E=1 MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081 bun run e2e:maestro',
      ].join('\n')}\n`,
    )
    process.exit(1)
  }

  return normalizeHttpUrl(value, 'MAESTRO_DEV_SERVER_URL')
}

function normalizeHttpUrl(value, label) {
  const normalized = value.trim().replace(/\/+$/, '')

  try {
    const url = new URL(normalized)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`${label} must use http or https`)
    }
    return url.toString().replace(/\/+$/, '')
  } catch (error) {
    process.stderr.write(`${label} is not a valid host-reachable URL: ${value}\n`)
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

function normalizeScheme(value) {
  const scheme = value.trim().replace(/:\/\/.*$/, '').replace(/:$/, '')
  if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) {
    process.stderr.write(`MAESTRO_DEV_CLIENT_SCHEME is not a valid URL scheme: ${value}\n`)
    process.exit(1)
  }
  return scheme
}

function buildDevClientUrl(scheme, metroUrl) {
  return `${normalizeScheme(scheme)}://expo-development-client/?url=${encodeURIComponent(
    metroUrl,
  )}&disableOnboarding=1`
}

function resolveMaestroBin() {
  if (process.env.MAESTRO_BIN) {
    return process.env.MAESTRO_BIN
  }

  const defaultInstallPath = join(homedir(), '.maestro/bin/maestro')
  const probe = spawnSync(defaultInstallPath, ['--version'], { stdio: 'ignore' })

  if (probe.status === 0) {
    return defaultInstallPath
  }

  return 'maestro'
}

function assertMaestroInstalled(maestroBin) {
  const result = spawnSync(maestroBin, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    process.stderr.write(
      `${[
        'Maestro CLI is not ready for this shell.',
        'Install it with: curl -fsSL "https://get.maestro.mobile.dev" | bash',
        'Make sure Java 17+ is active and ~/.maestro/bin is on PATH, or set MAESTRO_BIN.',
        detail ? `Probe output:\n${detail}` : undefined,
      ]
        .filter(Boolean)
        .join('\n')}\n`,
    )
    process.exit(1)
  }

  const installedVersion = parseVersion(result.stdout)
  const minimumVersion = parseVersion(maestroMinimumVersion)
  if (!installedVersion || !minimumVersion) {
    process.stderr.write(
      `Unable to compare Maestro CLI versions. Installed='${result.stdout.trim()}', minimum='${maestroMinimumVersion}'\n`,
    )
    process.exit(1)
  }

  if (compareVersions(installedVersion, minimumVersion) < 0) {
    process.stderr.write(
      `Unsupported Maestro CLI version: ${installedVersion.join(
        '.',
      )}. Minimum supported version: ${maestroMinimumVersion}. Run bun run e2e:maestro:setup.\n`,
    )
    process.exit(1)
  }

  process.stdout.write(`Maestro ${result.stdout.trim()}\n`)
}

function parseVersion(value) {
  const match = value.match(/\d+(?:\.\d+)+/)
  return match ? match[0].split('.').map((part) => Number.parseInt(part, 10)) : null
}

function compareVersions(left, right) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0
    const rightPart = right[index] ?? 0
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1
    }
  }
  return 0
}

async function preflightApi() {
  if (process.env.MAESTRO_SKIP_API_PREFLIGHT === '1') {
    return
  }

  if (!apiHealthUrl) {
    process.stderr.write(
      'E2E_API_HEALTH_URL or EXPO_PUBLIC_API_URL is required for API preflight. Set E2E_API_HEALTH_URL to a host-reachable /health URL, or set MAESTRO_SKIP_API_PREFLIGHT=1 to skip intentionally.\n',
    )
    process.exit(1)
  }

  try {
    await preflightHttp('API', apiHealthUrl)
  } catch (error) {
    process.stderr.write(
      `API preflight failed for ${apiHealthUrl}. Set E2E_API_HEALTH_URL to a host-reachable /health URL or MAESTRO_SKIP_API_PREFLIGHT=1 to skip intentionally.\n`,
    )
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

async function preflightMetro() {
  if (process.env.MAESTRO_SKIP_METRO_PREFLIGHT === '1') {
    return
  }

  try {
    await preflightHttp('Metro', metroStatusUrl)
  } catch (error) {
    process.stderr.write(
      `Metro preflight failed for ${metroStatusUrl}. Start Expo with --dev-client --host lan, set MAESTRO_DEV_SERVER_URL to that host-reachable URL, or set MAESTRO_SKIP_METRO_PREFLIGHT=1 to skip intentionally.\n`,
    )
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

async function preflightHttp(label, url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    process.stdout.write(`${label} preflight passed: ${url}\n`)
  } finally {
    clearTimeout(timeout)
  }
}

function assertE2eBundleMode() {
  if (process.env.MAESTRO_SKIP_E2E_ENV_PREFLIGHT === '1') {
    return
  }

  if (process.env.EXPO_PUBLIC_E2E === '1') {
    return
  }

  process.stderr.write(
    `${[
      'EXPO_PUBLIC_E2E=1 is required for the template Maestro flow.',
      'Expo reads EXPO_PUBLIC_* values when Metro serves or builds the JS bundle.',
      'Start Metro and run this script with EXPO_PUBLIC_E2E=1 so E2E-only integrations such as push registration stay disabled.',
      'Set MAESTRO_SKIP_E2E_ENV_PREFLIGHT=1 only when you intentionally validate a bundle built with the same E2E flag elsewhere.',
    ].join('\n')}\n`,
  )
  process.exit(1)
}

assertE2eBundleMode()
await preflightApi()
await preflightMetro()

if (process.env.MAESTRO_DRY_RUN === '1') {
  process.stdout.write(`Dry run: Maestro would open ${devClientUrl}\n`)
  process.exit(0)
}

mkdirSync(reportDir, { recursive: true })

const maestroBin = resolveMaestroBin()
assertMaestroInstalled(maestroBin)

const args = []

if (process.env.MAESTRO_DEVICE) {
  args.push('--device', process.env.MAESTRO_DEVICE)
}

args.push(
  'test',
  '--config',
  configPath,
  '--debug-output',
  resolve(reportDir, 'debug'),
  '--test-output-dir',
  resolve(reportDir, 'artifacts'),
  '-e',
  `APP_ID=${appId}`,
  '-e',
  `E2E_DISPLAY_NAME=${displayName}`,
  '-e',
  `E2E_EMAIL=${email}`,
  '-e',
  `E2E_PASSWORD=${password}`,
  '-e',
  `DEV_CLIENT_URL=${devClientUrl}`,
)

for (const [key, value] of Object.entries(testIds)) {
  args.push('-e', `${key}=${value}`)
}

args.push(flowPath)

process.stdout.write(`Running Maestro auth smoke against ${appId}\n`)
process.stdout.write(`Opening Expo dev-client bundle: ${devClientUrl}\n`)
process.stdout.write(`Report directory: ${reportDir}\n`)

const result = spawnSync(maestroBin, args, {
  cwd: mobileRoot,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
