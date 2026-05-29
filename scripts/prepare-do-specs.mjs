#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateDigitalOceanCronSchedule } from './do-cron.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratchDir = resolve(repoRoot, '.scratch/deploy')
const targets = new Set(['backend-initial', 'backend-final', 'webapp', 'website', 'all'])
const target = process.argv[2]
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

if (!targets.has(target)) {
  printUsage()
  process.exit(1)
}

const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'))
const projectSlug = doName(process.env.DO_PROJECT_SLUG ?? packageJson.name ?? 'app')
const gitBranch = requiredBranch()
const githubRepo = requiredGithubRepo()
assertCleanReleaseGitState(gitBranch)
const appRegion = process.env.DO_APP_REGION?.trim() || 'nyc'
const dbComponentName = doName(process.env.DO_DB_COMPONENT_NAME ?? `${projectSlug}-db`, 32)
const dbClusterName = doName(process.env.DO_DB_CLUSTER_NAME ?? `${projectSlug}-pg`)
const dbName = process.env.DO_DB_NAME?.trim() || 'defaultdb'
const dbUser = process.env.DO_DB_USER?.trim() || 'doadmin'
const apiServiceInstanceSizeSlug = optionalAppPlatformInstanceSizeSlugEnv(
  'DO_API_INSTANCE_SIZE_SLUG',
  defaultApiServiceInstanceSizeSlug,
)
const apiServiceInstanceCount = optionalPositiveIntegerEnv(
  'DO_API_INSTANCE_COUNT',
  defaultApiServiceInstanceCount,
)

await mkdir(scratchDir, { recursive: true })

if (target === 'backend-initial' || target === 'backend-final' || target === 'all') {
  const jwtSecret = requiredEnv('JWT_SECRET')
  assertStrongJwtSecret(jwtSecret)
  const webappUrl = target === 'backend-initial' ? 'https://placeholder.invalid' : requiredUrlEnv('DO_WEBAPP_URL')

  await writePreparedSpec('backend-app.yaml.example', 'backend-app.yaml', {
    ...commonReplacements(),
    REPLACE_WITH_AT_LEAST_32_RANDOM_CHARS: jwtSecret,
    'https://REPLACE_WITH_WEBAPP_DEFAULT_INGRESS': webappUrl,
    REPLACE_WITH_OPTIONAL_BACKEND_WORKERS: optionalBackendWorkersBlock(),
    REPLACE_WITH_OPTIONAL_BACKEND_CRON_JOBS: optionalBackendCronJobsBlock(),
  })
}

if (target === 'webapp' || target === 'all') {
  // The CSR webapp is deployed as a Static Site component; do not add service machine tiers here.
  await writePreparedSpec('webapp-static-app.yaml.example', 'webapp-static-app.yaml', {
    ...commonReplacements(),
    'https://REPLACE_WITH_BACKEND_DEFAULT_INGRESS': requiredUrlEnv('DO_BACKEND_URL'),
  })
}

if (target === 'website' || target === 'all') {
  // The website is a Static Site component until a route opts into SSR and needs a runtime process.
  await writePreparedSpec('website-static-app.yaml.example', 'website-static-app.yaml', {
    ...commonReplacements(),
    'https://REPLACE_WITH_WEBAPP_DEFAULT_INGRESS': requiredUrlEnv('DO_WEBAPP_URL'),
  })
}

console.log(`Prepared DigitalOcean specs under ${scratchDir}`)

function commonReplacements() {
  return {
    REPLACE_WITH_PROJECT_SLUG: projectSlug,
    REPLACE_WITH_DO_APP_REGION: appRegion,
    REPLACE_WITH_GITHUB_REPO: githubRepo,
    REPLACE_WITH_GIT_BRANCH: gitBranch,
    REPLACE_WITH_DO_DB_COMPONENT_NAME: dbComponentName,
    REPLACE_WITH_DO_DB_CLUSTER_NAME: dbClusterName,
    REPLACE_WITH_DO_DB_NAME: dbName,
    REPLACE_WITH_DO_DB_USER: dbUser,
    REPLACE_WITH_DO_API_INSTANCE_SIZE_SLUG: apiServiceInstanceSizeSlug,
    REPLACE_WITH_DO_API_INSTANCE_COUNT: String(apiServiceInstanceCount),
    REPLACE_WITH_OPTIONAL_EXPO_PUSH_ACCESS_TOKEN_ENV: optionalExpoPushAccessTokenEnvBlock('      '),
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
  await writeFile(outputPath, contents)
}

function printUsage() {
  console.error(`Usage: bun scripts/prepare-do-specs.mjs <${[...targets].join('|')}>`)
  console.error('')
  console.error('Required env:')
  console.error('  all targets: DO_GITHUB_REPO, optional DO_PROJECT_SLUG, DO_GIT_BRANCH, DO_APP_REGION')
  console.error('  backend-initial: JWT_SECRET')
  console.error('  backend-final: JWT_SECRET, DO_WEBAPP_URL')
  console.error('  webapp: DO_BACKEND_URL')
  console.error('  website: DO_WEBAPP_URL')
  console.error('  all: JWT_SECRET, DO_BACKEND_URL, DO_WEBAPP_URL')
  console.error('')
  console.error('Optional deployment settings:')
  console.error('  API sizing: DO_API_INSTANCE_SIZE_SLUG, DO_API_INSTANCE_COUNT')
  console.error('  Expo Push security: EXPO_PUSH_ACCESS_TOKEN')
  console.error('  worker: DO_BACKEND_WORKER_ENABLED=true, DO_BACKEND_WORKER_RUN_COMMAND')
  console.error('  cron: DO_BACKEND_CRON_NAME, DO_BACKEND_CRON_TASK, DO_BACKEND_CRON_SCHEDULE')
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
  assertMinLength('JWT_SECRET', value, 32)

  const normalized = value.trim().toLowerCase()
  if (
    normalized.length === 0 ||
    knownWeakJwtSecrets.has(normalized) ||
    new Set(normalized).size === 1
  ) {
    throw new Error('JWT_SECRET must be a non-placeholder random secret')
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

  const workerName = doName(process.env.DO_BACKEND_WORKER_NAME ?? 'worker', 32)
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
      branch: ${gitBranch}
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
      - key: JWT_SECRET
        value: ${yamlString(requiredEnv('JWT_SECRET'))}
        scope: RUN_TIME
        type: SECRET${optionalExpoPushAccessTokenEnvBlock('      ')}`
}

function requiredWorkerRunCommand(name) {
  const value = requiredEnv(name)
  assertSafeYamlString(name, value)

  if (value === 'bun run start:worker') {
    throw new Error(
      `${name} must point at a real long-running worker command. The template placeholder 'bun run start:worker' exits immediately and must not be deployed as an App Platform worker.`,
    )
  }

  return value
}

function optionalBackendCronJobsBlock() {
  const cronEnvNames = [
    'DO_BACKEND_CRON_NAME',
    'DO_BACKEND_CRON_TASK',
    'DO_BACKEND_CRON_SCHEDULE',
    'DO_BACKEND_CRON_TIME_ZONE',
  ]
  const hasCronEnv = cronEnvNames.some((name) => process.env[name]?.trim())

  if (!hasCronEnv) return ''

  const name = doName(requiredEnv('DO_BACKEND_CRON_NAME'), 32)
  const task = requiredSafeTaskName('DO_BACKEND_CRON_TASK')
  const schedule = requiredCronSchedule('DO_BACKEND_CRON_SCHEDULE')
  const timeZone = process.env.DO_BACKEND_CRON_TIME_ZONE?.trim() || 'UTC'

  assertSafeYamlString('DO_BACKEND_CRON_TIME_ZONE', timeZone)

  return `
  - name: ${name}
    kind: SCHEDULED
    github:
      repo: ${githubRepo}
      branch: ${gitBranch}
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
      - key: JWT_SECRET
        value: ${yamlString(requiredEnv('JWT_SECRET'))}
        scope: RUN_TIME
        type: SECRET${optionalExpoPushAccessTokenEnvBlock('      ')}`
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
