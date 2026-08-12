#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A phased release to Yandex Cloud: build and push the image, migrate, roll the API revision,
 * publish the static surfaces, verify.
 *
 * Phased rather than one command because a Yandex release is several independent operations and
 * any of them can fail halfway. Each finished phase is recorded in a state file keyed by the
 * commit, so `status` says what is done and re-running continues instead of redoing.
 *
 * The environment is the subtle part. Container environment variables belong to a revision, so a
 * revision deployed without them starts with none - a release would silently strip the production
 * configuration. This reads the active revision's environment and carries it forward unchanged,
 * altering only the image. Secrets therefore live in the cloud, never in this repository, and this
 * script never needs to see their values to deploy them.
 *
 * Infrastructure is not created here. Registries, containers, buckets, gateways, triggers, service
 * accounts and databases are provisioned once by following docs/YANDEX_CLOUD.md.
 */
const phaseOrder = ['build-push', 'migrate', 'deploy', 'publish-web', 'verify']

const requiredConfigKeys = [
  'YC_EXPECTED_CLOUD_ID',
  'YC_EXPECTED_FOLDER_ID',
  'YC_REGISTRY_ID',
  'YC_IMAGE_NAME',
  'YC_API_CONTAINER',
  'YC_SERVICE_ACCOUNT_ID',
]

/** `KEY=value` lines, `#` comments, optional surrounding quotes. No interpolation on purpose. */
export function parseDeployConfig(contents) {
  const config = {}

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    config[key] = value
  }

  return config
}

export function missingConfigKeys(config, required = requiredConfigKeys) {
  return required.filter((key) => !config[key]?.trim())
}

/**
 * The revision whose environment and settings the next release inherits.
 *
 * `yc` lists newest first, but an ACTIVE marker is the authority when one is present: a failed or
 * superseded newer revision must not become the source of the environment.
 */
export function activeRevision(revisions) {
  if (!Array.isArray(revisions) || revisions.length === 0) return undefined

  return revisions.find((revision) => revision?.status === 'ACTIVE') ?? revisions[0]
}

/**
 * Turns an environment map into repeated `--environment KEY=VALUE` arguments.
 *
 * One argument per variable, never one comma-joined string. `--environment` is a Cobra
 * `stringToString`: an argument holding a single `=` is taken whole, so a comma inside the value
 * survives, while an argument holding several is parsed as CSV and a comma then splits it into
 * bogus variables. A multi-origin `CORS_ORIGINS` is the common case that breaks, and it breaks
 * quietly - the revision deploys with a mangled origin list and browser auth fails afterwards.
 *
 * The combination this cannot express safely is a value containing both `=` and `,`. That is
 * refused rather than guessed at; docs/YANDEX_CLOUD.md points such values at the console or
 * Lockbox.
 */
export function environmentArguments(environment) {
  const args = []

  for (const [key, value] of Object.entries(environment ?? {})) {
    const text = String(value ?? '')

    if (/[\r\n]/.test(text)) {
      throw new Error(`${key} contains a line break, which cannot be passed on the command line`)
    }
    if (text.includes(',') && text.includes('=')) {
      throw new Error(
        `${key} contains both '=' and ',', which yc parses as CSV and would split into bogus variables. Set this one in the console or Lockbox and remove it from the release path.`,
      )
    }

    args.push('--environment', `${key}=${text}`)
  }

  return args
}

/** Phases still to run, so a resumed release repeats nothing and skips nothing. */
export function pendingPhases(state, { only, from } = {}) {
  if (only) return phaseOrder.includes(only) ? [only] : []

  const start = from ? phaseOrder.indexOf(from) : 0
  if (start === -1) return []

  return phaseOrder.slice(start).filter((phase) => !state?.completed?.includes(phase))
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (import.meta.main) {
  await main()
}

async function main() {
  const args = process.argv.slice(2)
  const command = args.find((arg) => !arg.startsWith('--'))
  const commands = new Set([...phaseOrder, 'release', 'status'])

  if (!command || !commands.has(command)) {
    console.error(`Usage: bun run release:yc <${[...commands].join('|')}> [--from <phase>] [--dry-run]`)
    console.error('')
    console.error('Reads backend/.env.deploy. Provision infrastructure first with docs/YANDEX_CLOUD.md.')
    process.exit(1)
  }

  const config = loadConfig()
  const commit = git(['rev-parse', '--short', 'HEAD'])
  const statePath = resolve(repoRoot, '.scratch/release', `${commit}.json`)
  const state = readState(statePath)

  if (command === 'status') {
    reportStatus({ commit, state, config })
    return
  }

  const dryRun = args.includes('--dry-run')
  const from = args[args.indexOf('--from') + 1]
  const phases =
    command === 'release'
      ? pendingPhases(state, { from: args.includes('--from') ? from : undefined })
      : pendingPhases(state, { only: command })

  if (phases.length === 0) {
    console.log(`[release:yc] nothing to do for ${commit}; run 'status' to see what is done`)
    return
  }

  assertCleanReleaseSource()
  assertExpectedCloud(config)

  const context = { config, commit, dryRun, tag: `${commit}` }

  for (const phase of phases) {
    console.log(`[release:yc] ${phase}`)
    await runPhase(phase, context)

    if (!dryRun) {
      state.completed = [...new Set([...(state.completed ?? []), phase])]
      writeState(statePath, state)
    }
  }

  console.log(`[release:yc] ${dryRun ? 'dry run complete' : `done: ${phases.join(', ')}`}`)
}

async function runPhase(phase, context) {
  if (phase === 'build-push') return buildAndPush(context)
  if (phase === 'migrate') return runMigrations(context)
  if (phase === 'deploy') return deployApi(context)
  if (phase === 'publish-web') return publishWeb(context)
  if (phase === 'verify') return verify(context)
}

function imageReference({ config, tag }) {
  return `cr.yandex/${config.YC_REGISTRY_ID}/${config.YC_IMAGE_NAME}:${tag}`
}

function buildAndPush(context) {
  const image = imageReference(context)

  run('docker', ['build', '-f', 'backend/Dockerfile', '-t', image, '.'], context)
  run('docker', ['push', image], context)
}

/**
 * Migrations run as a one-shot task revision of the same image, so they use the same Prisma client
 * and the same database configuration the API will use. A non-zero exit fails the release here,
 * before any traffic reaches a container whose schema does not match its code.
 */
function runMigrations(context) {
  const { config } = context
  const container = config.YC_MIGRATE_CONTAINER

  if (!container) {
    console.log('[release:yc] YC_MIGRATE_CONTAINER is unset; skipping migrations')
    return
  }

  const environment = activeEnvironment(container, context)

  run(
    'yc',
    [
      'serverless', 'container', 'revision', 'deploy',
      '--container-name', container,
      '--image', imageReference(context),
      '--runtime', 'task',
      '--command', 'bun',
      '--args', 'run,db:deploy',
      '--cores', config.YC_MIGRATE_CORES ?? '1',
      '--memory', config.YC_MIGRATE_MEMORY ?? '512MB',
      '--execution-timeout', config.YC_MIGRATE_TIMEOUT ?? '600s',
      '--service-account-id', config.YC_SERVICE_ACCOUNT_ID,
      ...environmentArguments(environment),
    ],
    context,
  )

  console.log(
    `[release:yc] invoke ${container} once and require HTTP 200 with X-Task-Exit-Code: 0 before trusting this release`,
  )
}

function deployApi(context) {
  const { config } = context
  const environment = activeEnvironment(config.YC_API_CONTAINER, context)

  run(
    'yc',
    [
      'serverless', 'container', 'revision', 'deploy',
      '--container-name', config.YC_API_CONTAINER,
      '--image', imageReference(context),
      '--cores', config.YC_API_CORES ?? '1',
      '--memory', config.YC_API_MEMORY ?? '1GB',
      '--concurrency', config.YC_API_CONCURRENCY ?? '1',
      '--execution-timeout', config.YC_API_TIMEOUT ?? '30s',
      '--service-account-id', config.YC_SERVICE_ACCOUNT_ID,
      ...environmentArguments(environment),
    ],
    context,
  )
}

/**
 * Hashed assets first, unhashed last: no page is ever live pointing at an asset that has not
 * landed. Hashed names can be cached forever; `index.html` keeps its name across releases and must
 * be revalidated, or the CDN serves the previous build indefinitely.
 */
function publishWeb(context) {
  const { config } = context
  const endpoint = config.YC_STORAGE_ENDPOINT ?? 'https://storage.yandexcloud.net'
  const immutable = 'public, max-age=31536000, immutable'
  const revalidate = 'public, max-age=0, must-revalidate'

  const surfaces = [
    { bucket: config.YC_WEBAPP_BUCKET, dist: 'webapp/dist', hashed: 'assets' },
    { bucket: config.YC_WEBSITE_BUCKET, dist: 'website/dist', hashed: '_astro' },
  ]

  for (const { bucket, dist, hashed } of surfaces) {
    if (!bucket) {
      console.log(`[release:yc] no bucket configured for ${dist}; skipping`)
      continue
    }
    if (!existsSync(resolve(repoRoot, dist))) {
      throw new Error(`${dist} is not built. Run the build for this surface before publishing.`)
    }

    const s3 = (args) => run('aws', [`--endpoint-url=${endpoint}`, 's3', ...args], context)
    const exclusions = ['--exclude', '*.br', '--exclude', '*.gz']

    s3(['cp', '--recursive', `${dist}/${hashed}/`, `s3://${bucket}/${hashed}/`, ...exclusions, '--cache-control', immutable])
    s3(['cp', '--recursive', `${dist}/`, `s3://${bucket}/`, ...exclusions, '--exclude', `${hashed}/*`, '--cache-control', revalidate])
  }
}

async function verify(context) {
  const { config, dryRun } = context
  const healthUrl = config.YC_HEALTH_URL

  if (!healthUrl) {
    console.log('[release:yc] YC_HEALTH_URL is unset; skipping the readiness check')
    return
  }
  if (dryRun) {
    console.log(`[release:yc] dry run: would GET ${healthUrl}`)
    return
  }

  const response = await fetch(healthUrl)
  if (!response.ok) {
    throw new Error(`${healthUrl} answered ${response.status}; the release is not verified`)
  }

  console.log(`[release:yc] ${healthUrl} answered ${response.status}`)
}

function activeEnvironment(containerName, { dryRun }) {
  const listed = yc([
    'serverless', 'container', 'revision', 'list',
    '--container-name', containerName,
    '--format', 'json',
  ])

  if (dryRun && !listed) return {}

  const revision = activeRevision(JSON.parse(listed || '[]'))

  if (!revision) {
    console.log(
      `[release:yc] ${containerName} has no revision yet; deploying with no environment. Set it in the console, then release again.`,
    )
    return {}
  }

  return revision.environment ?? {}
}

/**
 * The CLI profile, not this repository, decides which cloud is written to. Checked before the
 * first mutation: a release aimed at the wrong folder is expensive and not always reversible.
 */
function assertExpectedCloud(config) {
  // `yc config get <key>` and not `yc config list`: the list prints the profile's OAuth token
  // alongside the ids, and this output reaches logs and error messages. It also ignores
  // `--format json` and answers in YAML, so parsing it as JSON would throw here instead of
  // reporting a mismatch.
  const mismatches = cloudMismatches(
    {
      'cloud-id': yc(['config', 'get', 'cloud-id']).trim(),
      'folder-id': yc(['config', 'get', 'folder-id']).trim(),
    },
    config,
  )

  if (mismatches.length > 0) {
    fail(
      `the active yc profile points somewhere else: ${mismatches.join('; ')}.\nSwitch with: yc config profile activate <profile>`,
    )
  }
}

/** Which of the profile's ids disagree with the ones this project records. */
export function cloudMismatches(current, config) {
  return [
    ['cloud-id', current['cloud-id'], config.YC_EXPECTED_CLOUD_ID],
    ['folder-id', current['folder-id'], config.YC_EXPECTED_FOLDER_ID],
  ]
    .filter(([, actual, expected]) => expected && actual !== expected)
    .map(([name, actual, expected]) => `${name} is ${actual || 'unset'}, expected ${expected}`)
}

function assertCleanReleaseSource() {
  const lines = git(['status', '--short', '--branch']).split('\n').filter(Boolean)
  const branchLine = lines[0] ?? ''
  const dirty = lines.slice(1)

  if (!branchLine.includes('...')) {
    fail(`release branch must track a pushed upstream: ${branchLine}`)
  }
  if (/\[(ahead|behind|gone|diverged)/.test(branchLine)) {
    fail(`release branch must be pushed and in sync: ${branchLine}`)
  }
  if (dirty.length > 0) {
    const preview = dirty.slice(0, 8).join('\n')
    fail(
      `deployment requires a clean worktree. Stop instead of cleaning, stashing, resetting, or checking out over another session's work.\n${preview}`,
    )
  }
}

function reportStatus({ commit, state, config }) {
  console.log(`[release:yc] commit ${commit} -> ${config.YC_API_CONTAINER ?? '(no container configured)'}`)

  for (const phase of phaseOrder) {
    console.log(`  ${state.completed?.includes(phase) ? '[x]' : '[ ]'} ${phase}`)
  }

  const pending = pendingPhases(state)
  console.log(pending.length === 0 ? '  nothing pending' : `  next: ${pending[0]}`)
}

function loadConfig() {
  const configPath = resolve(repoRoot, 'backend/.env.deploy')

  if (!existsSync(configPath)) {
    fail(
      'backend/.env.deploy does not exist. Copy backend/.env.deploy.example to it and fill in the identifiers for this project.',
    )
  }

  const config = parseDeployConfig(readFileSync(configPath, 'utf8'))
  const missing = missingConfigKeys(config)

  if (missing.length > 0) {
    fail(`backend/.env.deploy is missing: ${missing.join(', ')}`)
  }

  return config
}

function readState(statePath) {
  if (!existsSync(statePath)) return { completed: [] }

  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return { completed: [] }
  }
}

function writeState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

function run(command, args, { dryRun }) {
  if (dryRun) {
    console.log(`  would run: ${command} ${args.join(' ')}`)
    return
  }

  try {
    execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' })
  } catch (error) {
    fail(`${command} ${args[0]} failed: ${error.message}`)
  }
}

function yc(args) {
  try {
    return execFileSync('yc', args, { cwd: repoRoot, encoding: 'utf8' })
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail('yc is not installed. See https://yandex.cloud/en/docs/cli/quickstart')
    }
    fail(`yc ${args.slice(0, 3).join(' ')} failed: ${error.stderr?.toString().trim() || error.message}`)
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch (error) {
    fail(`release source check failed while running git ${args.join(' ')}: ${error.message}`)
  }
}

function fail(message) {
  console.error(`[release:yc] ${message}`)
  process.exit(1)
}
