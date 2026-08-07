#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDomain } from 'tldts'

import { backgroundJobNames } from '../backend/src/jobs.ts'
import { parseAdminSeedConfig } from '../backend/src/modules/users/domain/admin-seed-config.ts'
import { validateDigitalOceanCronSchedule } from './do-cron.mjs'
import { collectionIsEmpty } from './runner-collections.mjs'

// Scheduling a task the runtime does not register deploys a job that exits non-zero every run.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratchDir = resolve(repoRoot, '.scratch/deploy')
const targets = new Set(['backend-initial', 'backend-final', 'webapp', 'website', 'all'])
const target = process.argv[2]
// A worker component restarts forever if its command exits, so refuse the two template runners
// while their configuration is still empty. Both are legitimate once they have work to do, which
// is why this reads the source instead of matching command strings.
const emptyRunnerConfigurations = [
  {
    command: 'bun run start:worker',
    source: 'backend/src/worker.ts',
    collection: 'workerLoops',
  },
  {
    command: 'bun run start:scheduler',
    source: 'backend/src/scheduler.ts',
    collection: 'schedules',
  },
]

const knownWeakJwtSecrets = new Set(['replace-with-at-least-32-random-characters'])
const appPlatformInstanceSizeSlugs = new Set([
  'apps-s-1vcpu-0.5gb',
  'apps-s-1vcpu-1gb-fixed',
  'apps-s-1vcpu-1gb',
  'apps-s-1vcpu-2gb',
  'apps-s-2vcpu-4gb',
  'apps-d-1vcpu-0.5gb',
  'apps-d-1vcpu-1gb',
  'apps-d-1vcpu-2gb',
  'apps-d-1vcpu-4gb',
  'apps-d-2vcpu-4gb',
  'apps-d-2vcpu-8gb',
  'apps-d-4vcpu-8gb',
  'apps-d-4vcpu-16gb',
  'apps-d-8vcpu-32gb',
])

// Budget-bearing DigitalOcean defaults live here so generated specs, tests, and docs have one owner.
// Webapp and website use Static Site templates on purpose, so they do not get runtime machine sizing.
const defaultApiServiceInstanceSizeSlug = 'apps-s-1vcpu-1gb'
const defaultApiServiceInstanceCount = 1
const defaultBackendWorkerInstanceSizeSlug = defaultApiServiceInstanceSizeSlug
const defaultBackendWorkerInstanceCount = 1
const notificationWorkerRunCommand = 'bun run start:worker:notifications'
const notificationCronTask = 'notifications:process'
const appPlatformComponentOwners = new Map()

if (!targets.has(target)) {
  printUsage()
  process.exit(1)
}

const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'))
const projectSlug = doName(process.env.DO_PROJECT_SLUG ?? packageJson.name ?? 'app')
assertProjectSlug(projectSlug)
const includesBackend = ['backend-initial', 'backend-final', 'all'].includes(target)
const gitBranch = validatedGitBranch(requiredBranch())
const githubRepo = requiredGithubRepo()
assertCleanReleaseGitState(gitBranch)
const appRegion = deploymentIdentifier(
  'DO_APP_REGION',
  process.env.DO_APP_REGION?.trim() || 'nyc',
  /^[a-z][a-z0-9-]{0,31}$/,
)
const dbComponentName = includesBackend
  ? appPlatformComponentName(
      'DO_DB_COMPONENT_NAME',
      process.env.DO_DB_COMPONENT_NAME ?? `${projectSlug}-db`,
    )
  : doName(process.env.DO_DB_COMPONENT_NAME ?? `${projectSlug}-db`, 32)
const dbClusterName = doName(process.env.DO_DB_CLUSTER_NAME ?? `${projectSlug}-pg`)
const dbName = deploymentIdentifier(
  'DO_DB_NAME',
  process.env.DO_DB_NAME?.trim() || 'defaultdb',
  /^[A-Za-z_][A-Za-z0-9_]{0,62}$/,
)
const dbUser = deploymentIdentifier(
  'DO_DB_USER',
  process.env.DO_DB_USER?.trim() || 'doadmin',
  /^[A-Za-z_][A-Za-z0-9_]{0,62}$/,
)
const apiServiceInstanceSizeSlug = optionalAppPlatformInstanceSizeSlugEnv(
  'DO_API_INSTANCE_SIZE_SLUG',
  defaultApiServiceInstanceSizeSlug,
)
const apiServiceInstanceCount = optionalPositiveIntegerEnv(
  'DO_API_INSTANCE_COUNT',
  defaultApiServiceInstanceCount,
)

const browserAuthSite = ['backend-final', 'webapp', 'all'].includes(target)
  ? requiredBrowserAuthSite()
  : undefined

await mkdir(scratchDir, { recursive: true })

let backendWebappUrl
let backendCorsOrigins
if (includesBackend) {
  reserveAppPlatformComponentName('api', 'API service')
  reserveAppPlatformComponentName(dbComponentName, 'database component')
  reserveAppPlatformComponentName('migrate', 'migration job')

  const jwtSecret = requiredEnv('JWT_SECRET')
  assertStrongJwtSecret(jwtSecret)
  backendWebappUrl = target === 'backend-initial'
    ? 'https://placeholder.invalid'
    : browserAuthSite.webappUrl
  backendCorsOrigins = buildBackendCorsOrigins(
    backendWebappUrl,
    browserAuthSite?.siteDomain,
  )

  await writePreparedSpec('backend-app.yaml.example', 'backend-app.yaml', {
    ...commonReplacements(),
    REPLACE_WITH_64_HEX_JWT_SECRET: jwtSecret,
    'https://REPLACE_WITH_WEBAPP_DEFAULT_INGRESS': backendCorsOrigins,
    REPLACE_WITH_OPTIONAL_BACKEND_WORKERS: optionalBackendWorkersBlock(),
    REPLACE_WITH_OPTIONAL_BACKEND_CRON_JOBS: optionalBackendCronJobsBlock(),
    REPLACE_WITH_OPTIONAL_ENABLE_TEST_PUSH_ENV: optionalRuntimeBooleanEnvBlock(
      'ENABLE_TEST_PUSH',
      '      ',
    ),
    REPLACE_WITH_OPTIONAL_IAP_ENVS: optionalIapEnvBlock('      '),
    REPLACE_WITH_OPTIONAL_STORAGE_ENVS: optionalStorageEnvBlock(),
    REPLACE_WITH_INITIAL_ADMIN_ENVS: initialAdminEnvBlock(),
  })
}

if (target === 'webapp' || target === 'all') {
  // The CSR webapp is deployed as a Static Site component; do not add service machine tiers here.
  await writePreparedSpec('webapp-static-app.yaml.example', 'webapp-static-app.yaml', {
    ...commonReplacements(),
    'https://REPLACE_WITH_BACKEND_DEFAULT_INGRESS': browserAuthSite.backendUrl,
  })
}

if (target === 'website' || target === 'all') {
  // Fully prerendered website output is a Static Site component; SSR/on-demand routes,
  // server islands, or other runtime-rendered routes need a runtime service instead.
  await writePreparedSpec('website-static-app.yaml.example', 'website-static-app.yaml', {
    ...commonReplacements(),
  })
}

console.log(`Prepared DigitalOcean specs under ${scratchDir}`)

function commonReplacements() {
  return {
    REPLACE_WITH_PROJECT_SLUG: projectSlug,
    REPLACE_WITH_DO_APP_REGION: appRegion,
    REPLACE_WITH_GITHUB_REPO: githubRepo,
    REPLACE_WITH_GIT_BRANCH: yamlString(gitBranch),
    REPLACE_WITH_DO_DB_COMPONENT_NAME: dbComponentName,
    REPLACE_WITH_DO_DB_CLUSTER_NAME: dbClusterName,
    REPLACE_WITH_DO_DB_NAME: yamlString(dbName),
    REPLACE_WITH_DO_DB_USER: yamlString(dbUser),
    REPLACE_WITH_DO_API_INSTANCE_SIZE_SLUG: apiServiceInstanceSizeSlug,
    REPLACE_WITH_DO_API_INSTANCE_COUNT: String(apiServiceInstanceCount),
  }
}

async function writePreparedSpec(templateName, outputName, replacements) {
  const templatePath = resolve(repoRoot, '.do', templateName)
  const outputPath = resolve(scratchDir, outputName)
  let contents = await readFile(templatePath, 'utf8')

  for (const [placeholder, value] of Object.entries(replacements)) {
    contents = contents.split(placeholder).join(value)
  }

  assertNoPlaceholders(outputName, contents)
  assertNoEmptyYamlValues(outputName, contents)
  assertSafeProductionEnv(outputName, contents)
  await writeFile(outputPath, contents, { mode: 0o600 })
  await chmod(outputPath, 0o600)
}

function printUsage() {
  console.error(`Usage: bun scripts/prepare-do-specs.mjs <${[...targets].join('|')}>`)
  console.error('')
  console.error('Required env:')
  console.error('  all targets: DO_GITHUB_REPO, optional DO_PROJECT_SLUG, DO_GIT_BRANCH, DO_APP_REGION')
  console.error('  backend-initial: JWT_SECRET, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD')
  console.error('  backend-final: JWT_SECRET, DO_BACKEND_URL, DO_WEBAPP_URL, DO_AUTH_SITE_DOMAIN')
  console.error('  webapp: DO_BACKEND_URL, DO_WEBAPP_URL, DO_AUTH_SITE_DOMAIN')
  console.error('  website: no target-specific values')
  console.error('  all: JWT_SECRET, DO_BACKEND_URL, DO_WEBAPP_URL, DO_AUTH_SITE_DOMAIN')
  console.error('')
  console.error('Optional deployment settings:')
  console.error('  API sizing: DO_API_INSTANCE_SIZE_SLUG, DO_API_INSTANCE_COUNT')
  console.error('  Expo Push security: EXPO_PUSH_ACCESS_TOKEN')
  console.error('  test push API route: ENABLE_TEST_PUSH=true (temporary verification only)')
  console.error('  App Store IAP: complete APPLE_IAP_* group (Production only)')
  console.error('  Google Play IAP: complete GOOGLE_PLAY_* group')
  console.error('  browser API origins: DO_ADDITIONAL_CORS_ORIGINS')
  console.error('  worker: DO_BACKEND_WORKER_ENABLED=true, DO_BACKEND_WORKER_RUN_COMMAND')
  console.error('  cron: DO_BACKEND_CRON_NAME, DO_BACKEND_CRON_TASK, DO_BACKEND_CRON_SCHEDULE')
  console.error('  notification recovery cron: DO_BACKEND_NOTIFICATION_CRON_NAME, DO_BACKEND_NOTIFICATION_CRON_SCHEDULE')
  console.error('  storage: complete SPACES_* group from backend/.env.example')
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required and cannot be empty`)
  }

  return value
}

function requiredUrlEnv(name) {
  return normalizeHttpsUrl(name, requiredEnv(name))
}

function initialAdminEnvBlock() {
  if (target !== 'backend-initial') return ''

  const { email, password } = parseAdminSeedConfig(process.env, { requirePassword: true })
  assertSafeYamlString('ADMIN_SEED_EMAIL', email)
  assertSafeYamlString('ADMIN_SEED_PASSWORD', password)

  return `      - key: ADMIN_SEED_EMAIL
        value: ${yamlString(email)}
        scope: RUN_TIME
        type: SECRET
      - key: ADMIN_SEED_PASSWORD
        value: ${yamlString(password)}
        scope: RUN_TIME
        type: SECRET`
}

function buildBackendCorsOrigins(webappUrl, authSiteDomain) {
  const additional = (process.env.DO_ADDITIONAL_CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => normalizeHttpsUrl('DO_ADDITIONAL_CORS_ORIGINS', origin))

  for (const origin of additional) {
    if (origin !== new URL(origin).origin) {
      throw new Error(`DO_ADDITIONAL_CORS_ORIGINS must contain origins only: ${origin}`)
    }
    if (authSiteDomain) {
      assertUrlBelongsToAuthSite('DO_ADDITIONAL_CORS_ORIGINS', origin, authSiteDomain)
    }
  }

  return [...new Set([webappUrl, ...additional])].join(',')
}

function requiredBrowserAuthSite() {
  const backendUrl = requiredUrlEnv('DO_BACKEND_URL')
  const webappUrl = requiredUrlEnv('DO_WEBAPP_URL')
  const deploymentUrls = [backendUrl, webappUrl]

  if (deploymentUrls.some((value) => new URL(value).hostname.endsWith('.ondigitalocean.app'))) {
    throw new Error(
      'Independent *.ondigitalocean.app domains are not supported for browser auth because refresh cookies may be blocked as third-party cookies. Configure API and webapp custom domains under one DO_AUTH_SITE_DOMAIN.',
    )
  }

  const siteDomain = requiredAuthSiteDomain()

  assertUrlBelongsToAuthSite('DO_BACKEND_URL', backendUrl, siteDomain)
  assertUrlBelongsToAuthSite('DO_WEBAPP_URL', webappUrl, siteDomain)

  return { backendUrl, siteDomain, webappUrl }
}

function requiredAuthSiteDomain() {
  const value = requiredEnv('DO_AUTH_SITE_DOMAIN').toLowerCase().replace(/\.$/, '')

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    throw new Error(
      'DO_AUTH_SITE_DOMAIN must be a registrable domain such as example.com, without a scheme, port, path, or leading dot',
    )
  }

  if (browserSiteForHostname(value) !== value) {
    throw new Error(
      'DO_AUTH_SITE_DOMAIN must be a registrable domain, not a public suffix or subdomain',
    )
  }

  return value
}

function assertUrlBelongsToAuthSite(name, value, siteDomain) {
  const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, '')

  if (browserSiteForHostname(hostname) !== siteDomain) {
    throw new Error(`${name} hostname must belong to DO_AUTH_SITE_DOMAIN (${siteDomain}): ${hostname}`)
  }
}

function browserSiteForHostname(hostname) {
  return getDomain(hostname, { allowPrivateDomains: true })
}

function normalizeHttpsUrl(name, value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') {
      throw new Error('URL must use https')
    }
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    throw new Error(`${name} must be an absolute https URL: ${error.message}`)
  }
}

function requiredGithubRepo() {
  const repo = requiredEnv('DO_GITHUB_REPO')

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('DO_GITHUB_REPO must use owner/repo format')
  }

  return repo
}

function requiredBranch() {
  const explicit = process.env.DO_GIT_BRANCH?.trim()
  if (explicit) return explicit

  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
    return branch || 'main'
  } catch {
    return 'main'
  }
}

function validatedGitBranch(value) {
  assertSafeYamlString('DO_GIT_BRANCH', value)

  try {
    execFileSync('git', ['check-ref-format', '--branch', value], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
  } catch {
    throw new Error('DO_GIT_BRANCH must be a valid Git branch name')
  }

  return value
}

function deploymentIdentifier(name, value, pattern) {
  assertSafeYamlString(name, value)
  if (!pattern.test(value)) {
    throw new Error(`${name} contains unsupported characters or exceeds its supported length`)
  }
  return value
}

function assertCleanReleaseGitState(gitBranch) {
  if (process.env.NODE_ENV === 'test' && process.env.DO_SKIP_RELEASE_GIT_CHECK_FOR_TESTS === '1') {
    return
  }

  const status = gitOutput(['status', '--short', '--branch'])
  const lines = status.split('\n').filter(Boolean)
  const branchLine = lines[0] ?? ''
  const dirtyLines = lines.slice(1)
  const currentBranch = gitOutput(['branch', '--show-current'])

  if (!currentBranch) {
    throw new Error('Deployment requires a named release branch. Stop instead of deploying from a detached checkout.')
  }

  if (currentBranch && currentBranch !== gitBranch) {
    throw new Error(
      `Deployment branch mismatch: current checkout is ${currentBranch}, but DO_GIT_BRANCH is ${gitBranch}. Switch to the release branch instead of deploying from a different dirty or partial workspace.`,
    )
  }

  if (!branchLine.includes('...')) {
    throw new Error(
      `Deployment branch must track a pushed upstream before generating specs: ${branchLine}. Push the intended release branch first, or stop deployment.`,
    )
  }

  if (/\[(ahead|behind|gone|diverged)/.test(branchLine)) {
    throw new Error(
      `Deployment branch must be pushed and in sync before generating specs: ${branchLine}. Commit and push the intended release, or stop deployment.`,
    )
  }

  if (dirtyLines.length > 0) {
    const preview = dirtyLines.slice(0, 8).join('\n')
    const suffix = dirtyLines.length > 8 ? `\n...and ${dirtyLines.length - 8} more` : ''
    throw new Error(
      `Deployment requires a clean worktree. Stop instead of cleaning, stashing, resetting, or checking out over another session's work.\n${preview}${suffix}`,
    )
  }
}

function gitOutput(args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
  } catch (error) {
    throw new Error(`Deployment release source check failed while running git ${args.join(' ')}: ${error.message}`)
  }
}

function assertMinLength(name, value, minimum) {
  if (value.length < minimum) {
    throw new Error(`${name} must be at least ${minimum} characters`)
  }
}

function assertStrongJwtSecret(value) {
  assertMinLength('JWT_SECRET', value, 64)

  const normalized = value.trim().toLowerCase()
  if (
    normalized.length === 0 ||
    knownWeakJwtSecrets.has(normalized) ||
    new Set(normalized).size === 1 ||
    !/^[a-f0-9]{64,}$/.test(normalized)
  ) {
    throw new Error('JWT_SECRET must be a non-placeholder random secret')
  }
}

function assertProjectSlug(value) {
  const longestAppName = `${value}-website`
  if (longestAppName.length > 32) {
    throw new Error(
      `DO_PROJECT_SLUG must be at most 24 characters so suffixed App Platform names stay within 32 characters`,
    )
  }
}

function assertNoPlaceholders(outputName, contents) {
  const placeholders = contents.match(/REPLACE_WITH_[A-Z0-9_]+/g)

  if (placeholders) {
    throw new Error(`${outputName} still contains placeholders: ${[...new Set(placeholders)].join(', ')}`)
  }
}

function assertNoEmptyYamlValues(outputName, contents) {
  const emptyValueLine = contents
    .split('\n')
    .find((line) => /^\s+value:\s*(?:""|'')?\s*$/.test(line))

  if (emptyValueLine) {
    throw new Error(`${outputName} contains an empty YAML value line: ${emptyValueLine.trim()}`)
  }
}

function assertSafeProductionEnv(outputName, contents) {
  const jwtSecret = findEnvValue(contents, 'JWT_SECRET')
  if (jwtSecret !== undefined) {
    assertStrongJwtSecret(jwtSecret)
  }

  const corsOrigins = findEnvValue(contents, 'CORS_ORIGINS')
  if (corsOrigins !== undefined) {
    assertCorsOrigins(outputName, corsOrigins)
  }

  for (const key of ['VITE_API_URL', 'PUBLIC_WEBAPP_URL']) {
    const value = findEnvValue(contents, key)
    if (value !== undefined) {
      assertBuildTimeHttpsUrl(outputName, key, value)
    }
  }
}

function findEnvValue(contents, key) {
  const lines = contents.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    if (!new RegExp(`^\\s*-\\s*key:\\s*${escapeRegExp(key)}\\s*$`).test(lines[index])) continue

    for (let valueIndex = index + 1; valueIndex < lines.length; valueIndex += 1) {
      if (/^\s*-\s*key:\s*/.test(lines[valueIndex])) break
      const match = lines[valueIndex].match(/^\s*value:\s*(.+?)\s*$/)
      if (match) return unquoteYamlScalar(match[1].trim())
    }
  }

  return undefined
}

function assertCorsOrigins(outputName, value) {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (origins.length === 0) {
    throw new Error(`${outputName} has empty CORS_ORIGINS`)
  }

  for (const origin of origins) {
    if (origin === '*') {
      throw new Error(`${outputName} must not use wildcard CORS_ORIGINS in production`)
    }

    const normalized = normalizeHttpsUrl('CORS_ORIGINS', origin)
    if (normalized !== new URL(normalized).origin) {
      throw new Error(`${outputName} CORS_ORIGINS must contain origins only, not paths: ${origin}`)
    }
  }
}

function assertBuildTimeHttpsUrl(outputName, key, value) {
  if (value.startsWith('${')) return

  const normalized = normalizeHttpsUrl(key, value)
  if (normalized !== new URL(normalized).origin) {
    throw new Error(`${outputName} ${key} must be an origin URL without a path: ${value}`)
  }
}

function optionalIapEnvBlock(indent, options = {}) {
  const includeApple = options.includeApple ?? true
  const includeGoogle = options.includeGoogle ?? true
  const appleNames = [
    'APPLE_IAP_BUNDLE_ID',
    'APPLE_IAP_APP_APPLE_ID',
    'APPLE_IAP_ENVIRONMENT',
    'APPLE_IAP_ISSUER_ID',
    'APPLE_IAP_KEY_ID',
    'APPLE_IAP_PRIVATE_KEY_BASE64',
    'APPLE_IAP_PRODUCT_IDS',
  ]
  const googleNames = [
    'GOOGLE_PLAY_PACKAGE_NAME',
    'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64',
    'GOOGLE_PLAY_PRODUCT_IDS',
    'GOOGLE_PLAY_BASE_PLAN_IDS',
  ]
  const appleConfigured = includeApple && appleNames.some((name) => process.env[name]?.trim())
  const googleConfigured = includeGoogle && googleNames.some((name) => process.env[name]?.trim())
  const values = {}
  const secretNames = new Set()

  if (options.requireGoogle && !googleConfigured) {
    throw new Error(
      'Google Play IAP settings are required for billing:google-play:reconcile',
    )
  }

  if (appleConfigured) {
    values.APPLE_IAP_BUNDLE_ID = requiredEnv('APPLE_IAP_BUNDLE_ID')
    values.APPLE_IAP_APP_APPLE_ID = requiredPositiveIntegerString('APPLE_IAP_APP_APPLE_ID')
    values.APPLE_IAP_ENVIRONMENT = requiredEnv('APPLE_IAP_ENVIRONMENT')
    if (values.APPLE_IAP_ENVIRONMENT !== 'Production') {
      throw new Error('APPLE_IAP_ENVIRONMENT must be Production in generated production specs')
    }
    values.APPLE_IAP_ISSUER_ID = requiredEnv('APPLE_IAP_ISSUER_ID')
    values.APPLE_IAP_KEY_ID = requiredEnv('APPLE_IAP_KEY_ID')
    values.APPLE_IAP_PRIVATE_KEY_BASE64 = requiredEnv('APPLE_IAP_PRIVATE_KEY_BASE64')
    values.APPLE_IAP_ROOT_CERTS_DIR = '/app/backend/src/modules/billing/certs/apple'
    values.APPLE_IAP_PRODUCT_IDS = requiredCommaSeparatedValues('APPLE_IAP_PRODUCT_IDS')
    secretNames.add('APPLE_IAP_PRIVATE_KEY_BASE64')
  }

  if (googleConfigured) {
    values.GOOGLE_PLAY_PACKAGE_NAME = requiredEnv('GOOGLE_PLAY_PACKAGE_NAME')
    values.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 = requiredEnv(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64',
    )
    values.GOOGLE_PLAY_PRODUCT_IDS = requiredCommaSeparatedValues('GOOGLE_PLAY_PRODUCT_IDS')
    values.GOOGLE_PLAY_BASE_PLAN_IDS = requiredCommaSeparatedValues('GOOGLE_PLAY_BASE_PLAN_IDS')
    secretNames.add('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64')
  }

  return Object.entries(values)
    .map(([name, value]) => {
      assertSafeYamlString(name, value)
      const type = secretNames.has(name) ? 'SECRET' : 'GENERAL'
      return `${indent}- key: ${name}\n${indent}  value: ${yamlString(value)}\n${indent}  scope: RUN_TIME\n${indent}  type: ${type}`
    })
    .join('\n')
}

function requiredPositiveIntegerString(name) {
  const value = requiredEnv(name)
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function requiredCommaSeparatedValues(name) {
  const values = requiredEnv(name)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value`)
  }

  return [...new Set(values)].join(',')
}

function optionalStorageEnvBlock() {
  const requiredNames = [
    'SPACES_REGION',
    'SPACES_BUCKET',
    'SPACES_ENDPOINT',
    'SPACES_ACCESS_KEY_ID',
    'SPACES_SECRET_ACCESS_KEY',
  ]
  const optionalNames = [
    'SPACES_CDN_BASE_URL',
    'SPACES_UPLOAD_MAX_BYTES',
    'SPACES_UPLOAD_URL_TTL_SECONDS',
    'SPACES_DOWNLOAD_URL_TTL_SECONDS',
    'SPACES_PUBLIC_CACHE_CONTROL',
  ]
  const configured = [...requiredNames, ...optionalNames].some((name) => process.env[name]?.trim())
  if (!configured) return ''

  const values = {
    SPACES_REGION: requiredEnv('SPACES_REGION'),
    SPACES_BUCKET: requiredEnv('SPACES_BUCKET'),
    SPACES_ENDPOINT: requiredUrlEnv('SPACES_ENDPOINT'),
    SPACES_ACCESS_KEY_ID: requiredEnv('SPACES_ACCESS_KEY_ID'),
    SPACES_SECRET_ACCESS_KEY: requiredEnv('SPACES_SECRET_ACCESS_KEY'),
    SPACES_UPLOAD_MAX_BYTES: String(optionalPositiveIntegerEnv('SPACES_UPLOAD_MAX_BYTES', 10 * 1024 * 1024)),
    SPACES_UPLOAD_URL_TTL_SECONDS: String(optionalPositiveIntegerEnv('SPACES_UPLOAD_URL_TTL_SECONDS', 900)),
    SPACES_DOWNLOAD_URL_TTL_SECONDS: String(optionalPositiveIntegerEnv('SPACES_DOWNLOAD_URL_TTL_SECONDS', 300)),
    SPACES_PUBLIC_CACHE_CONTROL:
      process.env.SPACES_PUBLIC_CACHE_CONTROL?.trim() || 'public, max-age=31536000, immutable',
  }
  const cdnBaseUrl = process.env.SPACES_CDN_BASE_URL?.trim()
  if (cdnBaseUrl) values.SPACES_CDN_BASE_URL = normalizeHttpsUrl('SPACES_CDN_BASE_URL', cdnBaseUrl)

  for (const [name, value] of Object.entries(values)) assertSafeYamlString(name, value)

  return Object.entries(values)
    .map(([name, value]) => {
      const type = name === 'SPACES_ACCESS_KEY_ID' || name === 'SPACES_SECRET_ACCESS_KEY'
        ? 'SECRET'
        : 'GENERAL'
      return `      - key: ${name}\n        value: ${yamlString(value)}\n        scope: RUN_TIME\n        type: ${type}`
    })
    .join('\n')
}

function optionalBackendWorkersBlock() {
  const workerEnvNames = [
    'DO_BACKEND_WORKER_ENABLED',
    'DO_BACKEND_WORKER_NAME',
    'DO_BACKEND_WORKER_RUN_COMMAND',
    'DO_BACKEND_WORKER_INSTANCE_SIZE_SLUG',
    'DO_BACKEND_WORKER_INSTANCE_COUNT',
  ]
  const enabled = optionalBooleanEnv('DO_BACKEND_WORKER_ENABLED')

  if (!enabled) {
    const configuredWithoutEnable = workerEnvNames
      .filter((name) => name !== 'DO_BACKEND_WORKER_ENABLED')
      .filter((name) => process.env[name]?.trim())

    if (configuredWithoutEnable.length > 0) {
      throw new Error(
        `Set DO_BACKEND_WORKER_ENABLED=true to use worker env: ${configuredWithoutEnable.join(', ')}`,
      )
    }

    return ''
  }

  const workerName = appPlatformComponentName(
    'DO_BACKEND_WORKER_NAME',
    process.env.DO_BACKEND_WORKER_NAME ?? 'worker',
  )
  reserveAppPlatformComponentName(workerName, 'backend worker')
  const runCommand = requiredWorkerRunCommand('DO_BACKEND_WORKER_RUN_COMMAND')
  const instanceSizeSlug = optionalAppPlatformInstanceSizeSlugEnv(
    'DO_BACKEND_WORKER_INSTANCE_SIZE_SLUG',
    defaultBackendWorkerInstanceSizeSlug,
  )
  const instanceCount = optionalPositiveIntegerEnv(
    'DO_BACKEND_WORKER_INSTANCE_COUNT',
    defaultBackendWorkerInstanceCount,
  )

  return `
workers:
  - name: ${workerName}
    github:
      repo: ${githubRepo}
      branch: ${yamlString(gitBranch)}
      deploy_on_push: true
    source_dir: /
    dockerfile_path: backend/Dockerfile
    run_command: ${yamlString(runCommand)}
    instance_size_slug: ${instanceSizeSlug}
    instance_count: ${instanceCount}
    envs:
      - key: DATABASE_URL
        value: "\${${dbComponentName}.DATABASE_URL}"
        scope: RUN_TIME
        type: SECRET
${
  runCommand === notificationWorkerRunCommand
    ? optionalExpoPushAccessTokenEnvBlock('      ')
    : ''
}`
}

function runnerHasNoWork({ command, source, collection }) {
  let contents

  try {
    contents = readFileSync(resolve(repoRoot, source), 'utf8')
  } catch {
    throw new Error(
      `A worker component asks for '${command}', but ${source} does not exist, so there is no way to tell whether that process has any work to do.`,
    )
  }

  return collectionIsEmpty(contents, collection)
}

function requiredWorkerRunCommand(name) {
  const value = requiredEnv(name)
  assertSafeYamlString(name, value)

  const runner = emptyRunnerConfigurations.find((candidate) => candidate.command === value)
  if (runner && runnerHasNoWork(runner)) {
    throw new Error(
      `${name} points at '${runner.command}', but '${runner.collection}' in ${runner.source} is still empty, so the process exits immediately and App Platform would restart it forever. Add entries there first (see docs/BACKGROUND_JOBS.md) or point the worker at your own command.`,
    )
  }

  return value
}

function optionalBackendCronJobsBlock() {
  const primaryCron = optionalPrimaryBackendCronJobBlock()
  const notificationCron = optionalNotificationBackendCronJobBlock()
  return `${primaryCron}${notificationCron}`
}

function optionalPrimaryBackendCronJobBlock() {
  const cronEnvNames = [
    'DO_BACKEND_CRON_NAME',
    'DO_BACKEND_CRON_TASK',
    'DO_BACKEND_CRON_SCHEDULE',
    'DO_BACKEND_CRON_TIME_ZONE',
  ]
  const hasCronEnv = cronEnvNames.some((name) => process.env[name]?.trim())

  if (!hasCronEnv) return ''

  const name = appPlatformComponentName(
    'DO_BACKEND_CRON_NAME',
    requiredEnv('DO_BACKEND_CRON_NAME'),
  )
  reserveAppPlatformComponentName(name, 'scheduled job')
  const task = requiredRegisteredJobName('DO_BACKEND_CRON_TASK')
  const schedule = requiredCronSchedule('DO_BACKEND_CRON_SCHEDULE')
  const timeZone = process.env.DO_BACKEND_CRON_TIME_ZONE?.trim() || 'UTC'

  assertSafeYamlString('DO_BACKEND_CRON_TIME_ZONE', timeZone)

  // Subscriptions ship switched off, so `billing:google-play:reconcile` is not a registered cron
  // task right now; scheduling it would deploy a job that exits non-zero on every run. Uncomment
  // the first branch together with the billing task in backend/src/cron.ts (docs/IAP.md).
  const providerEnv =
    // task === 'billing:google-play:reconcile'
    //   ? optionalIapEnvBlock('      ', { includeApple: false, requireGoogle: true }) :
    task === 'maintenance:process'
      ? optionalIapEnvBlock('      ', { includeApple: false })
      : task === notificationCronTask
        ? optionalExpoPushAccessTokenEnvBlock('      ')
        : ''

  return backendScheduledJobBlock({ name, providerEnv, schedule, task, timeZone })
}

function optionalNotificationBackendCronJobBlock() {
  const cronEnvNames = [
    'DO_BACKEND_NOTIFICATION_CRON_NAME',
    'DO_BACKEND_NOTIFICATION_CRON_SCHEDULE',
    'DO_BACKEND_NOTIFICATION_CRON_TIME_ZONE',
  ]
  const hasCronEnv = cronEnvNames.some((name) => process.env[name]?.trim())
  if (!hasCronEnv) return ''

  if (process.env.DO_BACKEND_CRON_TASK?.trim() === notificationCronTask) {
    throw new Error(
      'DO_BACKEND_CRON_TASK already configures notifications:process; use the dedicated notification cron settings only when the primary cron owns a different task.',
    )
  }

  const name = appPlatformComponentName(
    'DO_BACKEND_NOTIFICATION_CRON_NAME',
    requiredEnv('DO_BACKEND_NOTIFICATION_CRON_NAME'),
  )
  reserveAppPlatformComponentName(name, 'notification scheduled job')
  const schedule = requiredCronSchedule('DO_BACKEND_NOTIFICATION_CRON_SCHEDULE')
  const timeZone = process.env.DO_BACKEND_NOTIFICATION_CRON_TIME_ZONE?.trim() || 'UTC'
  assertSafeYamlString('DO_BACKEND_NOTIFICATION_CRON_TIME_ZONE', timeZone)

  return backendScheduledJobBlock({
    name,
    providerEnv: optionalExpoPushAccessTokenEnvBlock('      '),
    schedule,
    task: notificationCronTask,
    timeZone,
  })
}

function backendScheduledJobBlock({ name, providerEnv, schedule, task, timeZone }) {
  return `
  - name: ${name}
    kind: SCHEDULED
    github:
      repo: ${githubRepo}
      branch: ${yamlString(gitBranch)}
      deploy_on_push: true
    source_dir: /
    dockerfile_path: backend/Dockerfile
    run_command: ${yamlString(`bun run start:cron -- ${task}`)}
    instance_count: 1
    schedule:
      cron: ${yamlString(schedule)}
      time_zone: ${yamlString(timeZone)}
    envs:
      - key: DATABASE_URL
        value: "\${${dbComponentName}.DATABASE_URL}"
        scope: RUN_TIME
        type: SECRET
${providerEnv}`
}

function optionalExpoPushAccessTokenEnvBlock(indent) {
  const accessToken = process.env.EXPO_PUSH_ACCESS_TOKEN?.trim()
  if (!accessToken) return ''

  assertSafeYamlString('EXPO_PUSH_ACCESS_TOKEN', accessToken)
  return `
${indent}- key: EXPO_PUSH_ACCESS_TOKEN
${indent}  value: ${yamlString(accessToken)}
${indent}  scope: RUN_TIME
${indent}  type: SECRET`
}

function optionalRuntimeBooleanEnvBlock(name, indent) {
  const value = process.env[name]?.trim()
  if (!value) return ''

  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be true or false`)
  }

  return `${indent}- key: ${name}
${indent}  value: ${yamlString(value)}
${indent}  scope: RUN_TIME
${indent}  type: GENERAL`
}

function optionalBooleanEnv(name) {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return false

  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false

  throw new Error(`${name} must be true or false`)
}

function optionalPositiveIntegerEnv(name, defaultValue) {
  const value = process.env[name]?.trim()
  if (!value) return defaultValue

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

function optionalAppPlatformInstanceSizeSlugEnv(name, defaultValue) {
  const value = process.env[name]?.trim() || defaultValue
  assertSafeYamlString(name, value)

  if (!appPlatformInstanceSizeSlugs.has(value)) {
    throw new Error(`${name} must be one of: ${[...appPlatformInstanceSizeSlugs].join(', ')}`)
  }

  return value
}

// A scheduled component runs `start:cron -- <job>`, so a typo here is only discovered when the
// job fails on every tick in production. The registry is the authority on which names exist.
function requiredRegisteredJobName(name) {
  const value = requiredSafeTaskName(name)
  const registered = backgroundJobNames()

  if (!registered.includes(value)) {
    throw new Error(
      `${name} is '${value}', which is not a job in backend/src/jobs.ts. Available jobs: ${registered.join(', ')}. ` +
        'Capabilities that ship switched off, such as billing:google-play:reconcile, register their ' +
        'jobs only after they are turned on.',
    )
  }

  return value
}

function requiredSafeTaskName(name) {
  const value = requiredEnv(name)

  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value)) {
    throw new Error(`${name} must use only letters, numbers, dots, underscores, colons, or dashes`)
  }

  return value
}

function requiredCronSchedule(name) {
  const value = requiredEnv(name)
  assertSafeYamlString(name, value)
  return validateDigitalOceanCronSchedule(value, { name })
}

function assertSafeYamlString(name, value) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${name} must be a single-line value`)
  }
}

function yamlString(value) {
  return JSON.stringify(value)
}

function doName(value, maxLength = 63) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const withLetterStart = /^[a-z]/.test(normalized) ? normalized : `app-${normalized}`
  const fallback = withLetterStart === 'app-' ? 'app-template' : withLetterStart
  return fallback.slice(0, maxLength).replace(/-+$/g, '') || 'app-template'
}

function appPlatformComponentName(envName, value) {
  const normalized = doName(value, 32)

  if (!/^[a-z][a-z0-9-]{1,31}$/.test(normalized)) {
    throw new Error(
      `${envName} must normalize to an App Platform component name with 2 to 32 characters`,
    )
  }

  return normalized
}

function reserveAppPlatformComponentName(name, owner) {
  const existingOwner = appPlatformComponentOwners.get(name)

  if (existingOwner) {
    throw new Error(`${owner} component name "${name}" conflicts with ${existingOwner}`)
  }

  appPlatformComponentOwners.set(name, owner)
}

function unquoteYamlScalar(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
