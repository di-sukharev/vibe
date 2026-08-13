#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A phased release to Yandex Cloud: build and push the image, roll the API revision, publish the
 * static surfaces, verify.
 *
 * Phased rather than one command because a Yandex release is several independent operations and
 * any of them can fail halfway. Each finished phase is recorded in a state file keyed by the
 * commit, so `status` says what is done and re-running continues instead of redoing.
 *
 * Migrations are deliberately not a phase. This script holds no `DATABASE_URL` by design, so it
 * could not tell whether one succeeded; `docs/YANDEX_CLOUD.md` owns that step, and it runs before
 * a release. DigitalOcean gets the ordering guarantee for free from App Platform's `PRE_DEPLOY`
 * job kind, and Yandex has no equivalent - that asymmetry is the provider's, not this script's.
 *
 * The environment is the subtle part. Container environment variables belong to a revision, so a
 * revision deployed without them starts with none - a release would silently strip the production
 * configuration. This reads the active revision and carries its settings forward, altering only the
 * image. Secrets therefore live in the cloud, never in this repository, and this script never needs
 * to see their values to deploy them.
 *
 * Because `yc serverless container revision deploy` is 32 imperative flags with no declarative
 * spec input, anything not passed resets to a default. Rather than reproducing every setting from
 * memory - the mistake that shape invites - the script declares what it reproduces and refuses any
 * revision carrying something else. See `unreproducibleRevisionFields`.
 *
 * Infrastructure is not created here. Registries, containers, buckets, gateways, triggers, service
 * accounts and databases are provisioned once by following docs/YANDEX_CLOUD.md.
 */
const phaseOrder = ['build-push', 'deploy', 'publish-web', 'verify']

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
 * The API reference spells revision fields in camelCase and the CLI answers in snake_case, so
 * every comparison against a field name normalizes first. Reading the wrong spelling is how a
 * guard silently matches nothing and passes everything through.
 */
function snakeCase(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function normalizeKeys(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [snakeCase(key), item]))
}

/**
 * The container environment, which lives inside `image` and not at the revision root.
 *
 * Worth stating because the obvious reading is wrong: a revision has no `environment` of its own,
 * so `revision.environment` is always undefined and a release built on it would deploy a container
 * with no configuration at all.
 */
export function revisionEnvironment(revision) {
  return normalizeKeys(normalizeKeys(revision)?.image)?.environment ?? {}
}

// What a deployed revision carries that this script either sets from the release or may ignore.
// Everything absent from these two sets is, by definition, something it cannot reproduce.
const reproducedRevisionFields = new Set([
  'image',
  'resources',
  'execution_timeout',
  'concurrency',
  'service_account_id',
])
const informationalRevisionFields = new Set([
  'id',
  'container_id',
  'description',
  'created_at',
  'status',
])

/**
 * Fields the provider fills in on every revision, matched only at their default value.
 *
 * These cannot be judged by presence: Yandex returns `log_options` and `metadata_options` on
 * revisions nobody configured, so refusing whenever they appear would refuse every release after
 * the first and make the phase unusable. Refusing whenever they differ keeps the property that
 * matters - a setting someone chose is never silently reset - while letting an untouched container
 * through. A default that changes upstream shows up as a refusal naming the field, which is the
 * safe direction to be wrong in.
 */
const providerDefaultRevisionFields = {
  // Only the folder the logs go to; a log group or disabled logging is a choice. `min_level` counts
  // as unset when it carries the enum's unspecified member, which is how an untouched revision can
  // serialise it.
  log_options: (value) =>
    Object.entries(value).every(
      ([key, item]) => key === 'folder_id' || (key === 'min_level' && isUnspecifiedEnum(item)),
    ),
  // Both spellings of "nobody chose this": the enum's unspecified member, and the resolved pair a
  // live revision reports. Deliberately not narrowed to one - the proto documents UNSPECIFIED as
  // the default while the CLI has been observed returning the resolved values, and refusing on the
  // spelling this happens not to expect would block every release rather than protect anything.
  metadata_options: (value) =>
    Object.values(value).every((item) => isUnspecifiedEnum(item)) ||
    (value.gce_http_endpoint === 'ENABLED' && value.aws_v1_http_endpoint === 'DISABLED'),
  // A task container is a different execution method that this would silently rebuild as `http`.
  // Its command and args are refused separately, but classing it here keeps the function's promise
  // that everything it does not re-pass is named rather than dropped.
  runtime: (value) => 'http' in value,
}

function isUnspecifiedEnum(value) {
  return typeof value === 'string' && value.endsWith('_UNSPECIFIED')
}
const reproducedImageFields = new Set(['image_url', 'image_digest', 'environment'])

/**
 * Fields of the live revision this script would drop if it deployed on top of it.
 *
 * Derived from the payload rather than from a list of things to refuse, so the failure direction
 * is safe: a field Yandex adds later arrives, matches neither set above, and stops the release by
 * name. A remembered refusal list would decay the other way and silently discard it - which is
 * exactly the class of mistake that makes a release quietly destructive.
 */
export function unreproducibleRevisionFields(revision) {
  const normalized = normalizeKeys(revision)
  if (normalized == null) return []

  const unreproducible = []

  for (const [key, value] of Object.entries(normalized)) {
    if (informationalRevisionFields.has(key) || isEmptyValue(value)) continue

    if (key === 'image') {
      for (const [imageKey, imageValue] of Object.entries(normalizeKeys(value) ?? {})) {
        if (!reproducedImageFields.has(imageKey) && !isEmptyValue(imageValue)) {
          unreproducible.push(`image.${imageKey}`)
        }
      }
      continue
    }

    const isDefault = providerDefaultRevisionFields[key]
    if (isDefault) {
      if (!isDefault(normalizeKeys(value) ?? {})) unreproducible.push(key)
      continue
    }

    if (!reproducedRevisionFields.has(key)) unreproducible.push(key)
  }

  return unreproducible.sort()
}

function isEmptyValue(value) {
  if (value == null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0

  return false
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
    // An argument holding more than one `=` goes through yc's CSV parser, where a comma splits the
    // value into bogus variables and a quote is a parse error that echoes the whole `KEY=value` to
    // stderr - printing the credential this script is careful never to print anywhere else.
    if (text.includes('=') && /[",]/.test(text)) {
      throw new Error(
        `${key} contains '=' together with a quote or a comma, which yc parses as CSV: the value would be split into bogus variables, or rejected with the value itself echoed to the terminal. This value cannot travel the release path - change it, or deploy this container from the console.`,
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
  // Skip the value of `--from`, or `release:yc --from deploy release` would take `deploy` as the
  // command, run that one phase, and report success without publishing or verifying anything.
  const command = args.find(
    (arg, index) => !arg.startsWith('--') && args[index - 1] !== '--from',
  )
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
  const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : undefined

  // A misspelled phase would otherwise select nothing and exit 0, which reads as "already done";
  // a trailing `--from` with nothing after it would quietly run the whole release instead.
  if (args.includes('--from') && !phaseOrder.includes(from)) {
    fail(`--from ${from ?? '(missing)'} is not a phase. Use one of: ${phaseOrder.join(', ')}`)
  }

  const phases =
    command === 'release' ? pendingPhases(state, { from }) : pendingPhases(state, { only: command })

  if (phases.length === 0) {
    console.log(`[release:yc] nothing to do for ${commit}; run 'status' to see what is done`)
    return
  }

  // See the same exemption in scripts/deploy-do.mjs: a dry run mutates nothing, and refusing it on
  // a dirty worktree would make it useless for the edit it is meant to check.
  if (!dryRun) assertCleanReleaseSource()
  assertExpectedCloud(config)

  const context = { config, commit, dryRun, tag: `${commit}` }

  if (phases.includes('deploy')) {
    console.log(
      '[release:yc] deploy ships new code against the current schema. Apply pending Prisma migrations first - see "Managed PostgreSQL" in docs/YANDEX_CLOUD.md.',
    )
  }

  for (const phase of phases) {
    console.log(`[release:yc] ${phase}`)
    // A phase reports its own reason and exits; an uncaught throw here would print a stack trace
    // instead, halfway through a release, which is the worst moment to make someone read one.
    try {
      await runPhase(phase, context)
    } catch (error) {
      fail(`${phase} failed: ${error.message}`)
    }

    if (!dryRun) {
      state.completed = [...new Set([...(state.completed ?? []), phase])]
      writeState(statePath, state)
    }
  }

  console.log(`[release:yc] ${dryRun ? 'dry run complete' : `done: ${phases.join(', ')}`}`)

  if (phases.includes('deploy')) {
    console.log(
      '[release:yc] this rolled the API container only. Redeploy the task containers for background jobs too - see "Releases" in docs/YANDEX_CLOUD.md.',
    )
  }
}

async function runPhase(phase, context) {
  if (phase === 'build-push') return buildAndPush(context)
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
 * Rolls a new API revision carrying the live one's settings, changing only the image.
 *
 * A revision owns its whole configuration, and `revision deploy` builds the new one from the flags
 * given, so anything not passed here silently reverts to a default. That makes the refusal below
 * the load-bearing part: rather than reproducing fifteen settings from memory, the script states
 * what it reproduces and stops when the live revision carries anything else. Stopping costs a
 * console visit; guessing costs a container that has lost its Lockbox secrets or its network.
 */
function deployApi(context) {
  const { config } = context
  const revision = liveRevision(config.YC_API_CONTAINER, context)

  if (!revision) {
    console.log(
      `[release:yc] ${config.YC_API_CONTAINER} has no revision yet. Deploying the first one from backend/.env.deploy; set its environment in the console afterwards, and it will be carried forward from the next release on.`,
    )
  }

  const unreproducible = unreproducibleRevisionFields(revision)
  if (unreproducible.length > 0) {
    fail(
      // The inspect command deletes `image.environment` on the way out. The rest of the revision is
      // configuration worth reading; that field is the production environment in plaintext, and an
      // operator stopped mid-release by a refusal they do not understand is exactly who pastes a
      // terminal buffer into a chat.
      `the live revision of ${config.YC_API_CONTAINER} carries settings this script cannot reproduce: ${unreproducible.join(', ')}.\nA new revision built here would drop them, so deploy this container from the console or Terraform instead.\nIf one of these is a field the provider populates on its own rather than something you configured, inspect it with:\n  yc serverless container revision list --container-name ${config.YC_API_CONTAINER} --format json | jq '.[0] | del(.image.environment)'`,
    )
  }

  const resources = normalizeKeys(normalizeKeys(revision)?.resources) ?? {}
  const live = normalizeKeys(revision) ?? {}
  const coreFraction = resources.core_fraction

  run(
    'yc',
    [
      'serverless', 'container', 'revision', 'deploy',
      '--container-name', config.YC_API_CONTAINER,
      '--image', imageReference(context),
      '--cores', String(resources.cores ?? config.YC_API_CORES ?? '1'),
      '--memory', String(resources.memory ?? config.YC_API_MEMORY ?? '1GB'),
      // Carried rather than defaulted: a container provisioned at a fraction of a core is a cost
      // decision, and re-creating it at 100% is a silent bill increase on a green release.
      ...(coreFraction ? ['--core-fraction', String(coreFraction)] : []),
      '--concurrency', String(live.concurrency ?? config.YC_API_CONCURRENCY ?? '1'),
      '--execution-timeout', String(live.execution_timeout ?? config.YC_API_TIMEOUT ?? '30s'),
      // The live revision is the truth about which identity the container runs as; the config value
      // seeds the first revision only, so a service account changed in the console is not reverted.
      '--service-account-id', live.service_account_id ?? config.YC_SERVICE_ACCOUNT_ID,
      ...environmentArguments(revisionEnvironment(revision)),
    ],
    context,
    { quiet: true },
  )

  console.log(`[release:yc] ${config.YC_API_CONTAINER} revision deployed with ${imageReference(context)}`)
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

/**
 * Confirms that the image this release built is the one now serving, then that it is ready.
 *
 * The image check is not redundant with the health check, it is what stops the health check from
 * lying: a release whose `deploy` never took effect still answers 200 from the previous revision,
 * so readiness alone would report a green release of a build that never shipped - while the static
 * surfaces published in the same run are already the new ones.
 */
async function verify(context) {
  const { config, dryRun } = context
  const expectedImage = imageReference(context)

  if (dryRun) {
    console.log(`[release:yc] dry run: would check the active revision runs ${expectedImage}`)
    if (config.YC_HEALTH_URL) console.log(`[release:yc] dry run: would GET ${config.YC_HEALTH_URL}`)
    return
  }

  const runningImage = normalizeKeys(normalizeKeys(liveRevision(config.YC_API_CONTAINER, context))?.image)?.image_url

  if (runningImage !== expectedImage) {
    fail(
      `${config.YC_API_CONTAINER} is serving ${runningImage ?? 'no image'}, not ${expectedImage}. The release did not take effect; do not treat it as done.`,
    )
  }

  console.log(`[release:yc] ${config.YC_API_CONTAINER} is serving ${expectedImage}`)

  if (!config.YC_HEALTH_URL) {
    console.log('[release:yc] YC_HEALTH_URL is unset; skipping the readiness check')
    return
  }

  const response = await fetch(config.YC_HEALTH_URL)
  if (!response.ok) {
    fail(`${config.YC_HEALTH_URL} answered ${response.status}; the release is not verified`)
  }

  console.log(`[release:yc] ${config.YC_HEALTH_URL} answered ${response.status}`)
}

/** The revision whose settings the next one inherits, or undefined for a container with none. */
function liveRevision(containerName, { dryRun }) {
  const listed = yc([
    'serverless', 'container', 'revision', 'list',
    '--container-name', containerName,
    '--format', 'json',
  ])

  if (dryRun && !listed) return undefined

  return activeRevision(JSON.parse(listed || '[]'))
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

/**
 * Every `--environment KEY=value` argument with its value replaced by the key alone.
 *
 * The arguments carry the production environment - `DATABASE_URL`, `JWT_SECRET`, storage and email
 * credentials - so neither the dry run nor a failure message may print them verbatim. `--dry-run`
 * is what a careful operator runs first, and `execFileSync` puts the whole command line into
 * `error.message`, so both paths would otherwise write the secrets to the terminal and into
 * whatever captured that output.
 */
export function redactArguments(args) {
  return args.map((arg, index) =>
    args[index - 1] === '--environment' ? `${String(arg).split('=')[0]}=<hidden>` : arg,
  )
}

/**
 * `quiet` keeps the child's stdout out of the terminal, for commands that echo what they created.
 *
 * `yc serverless container revision deploy` prints the new revision on success, environment values
 * included in plaintext - so inheriting stdout would put `DATABASE_URL` and `JWT_SECRET` on screen
 * and into whatever captured the release output, defeating the redaction on every other path.
 * stderr still passes through, because that is where a failure explains itself.
 */
function run(command, args, { dryRun }, { quiet = false } = {}) {
  const printable = () => `${command} ${redactArguments(args).join(' ')}`

  if (dryRun) {
    console.log(`  would run: ${printable()}`)
    return
  }

  try {
    execFileSync(command, args, {
      cwd: repoRoot,
      stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
    })
  } catch (error) {
    // Deliberately not `error.message`: for execFileSync it is the whole command line.
    fail(`${printable()} failed with exit code ${error.status ?? 'unknown'}`)
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
