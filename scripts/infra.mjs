#!/usr/bin/env bun

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const supportedProviders = new Set(['digitalocean', 'yandex'])
const providerRootNames = {
  digitalocean: ['foundation', 'runtime', 'static'],
  yandex: ['foundation', 'migration', 'runtime'],
}
const terraformEnvironment = {
  ...process.env,
  CHECKPOINT_DISABLE: '1',
  TF_IN_AUTOMATION: '1',
  TF_INPUT: '0',
}

const protectedResourcePatterns = [
  /digitalocean_container_registry\.production/,
  /digitalocean_database_(cluster|db|firewall|user)\./,
  /digitalocean_spaces_bucket\.(media|terraform_state)/,
  /digitalocean_spaces_key\.(media|terraform_state)/,
  /yandex_mdb_postgresql_(cluster|database|user)\./,
  /yandex_storage_bucket\.(media|terraform_state)/,
  /yandex_storage_bucket_policy\.terraform_state/,
  /yandex_iam_service_account\.terraform_state/,
  /yandex_iam_service_account_static_access_key\.(media|postbox|terraform_state)/,
  /yandex_lockbox_secret\.(media|migration_database|runtime|postbox)/,
]

function providerPaths(provider) {
  const providerRoot = resolve(repoRoot, 'infra', provider)
  const productionRoot = resolve(providerRoot, 'production')
  const roots = {
    bootstrap: resolve(providerRoot, 'bootstrap'),
    foundation: productionRoot,
    operations: resolve(providerRoot, 'operations'),
    runtime: resolve(providerRoot, 'runtime'),
    ...(provider === 'digitalocean'
      ? { static: resolve(providerRoot, 'static') }
      : { migration: resolve(providerRoot, 'migration') }),
  }
  return {
    providerRoot,
    roots,
    bootstrapRoot: roots.bootstrap,
    productionRoot,
    stateEnvironment: resolve(providerRoot, '.env.terraform-state'),
  }
}

/** Parse only scalar assignments. Terraform expressions, maps, and interpolation are never run. */
export function parseSimpleAssignments(contents) {
  const result = {}
  const scalar =
    /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|(null|true|false|-?\d+(?:\.\d+)?))\s*(?:#.*)?$/

  for (const rawLine of contents.split(/\r?\n/)) {
    const match = rawLine.trim().match(scalar)
    if (!match) continue

    const [, key, doubleQuoted, singleQuoted, primitive] = match
    if (doubleQuoted !== undefined) {
      result[key] = JSON.parse(`"${doubleQuoted}"`)
    } else if (singleQuoted !== undefined) {
      result[key] = singleQuoted
    } else if (primitive === 'null') {
      result[key] = null
    } else if (primitive === 'true' || primitive === 'false') {
      result[key] = primitive === 'true'
    } else {
      result[key] = Number(primitive)
    }
  }

  return result
}

function parseEnvironmentFile(contents) {
  const result = {}

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue

    const key = line.slice(0, separator).trim()
    const encoded = line.slice(separator + 1).trim()
    if (encoded.startsWith('"')) {
      result[key] = JSON.parse(encoded)
    } else if (encoded.startsWith("'") && encoded.endsWith("'")) {
      result[key] = encoded.slice(1, -1)
    } else {
      result[key] = encoded
    }
  }

  return result
}

export function renderBackendConfig(provider, { bucket, key, region }) {
  if (!supportedProviders.has(provider))
    throw new Error(`Unsupported provider: ${provider}`)

  const endpoint =
    provider === 'digitalocean'
      ? `https://${region}.digitaloceanspaces.com`
      : 'https://storage.yandexcloud.net'

  const backendRegion = provider === 'digitalocean' ? 'us-east-1' : region
  return `bucket = ${JSON.stringify(bucket)}
key    = ${JSON.stringify(key)}
region = ${JSON.stringify(backendRegion)}

endpoints = {
  s3 = ${JSON.stringify(endpoint)}
}

use_lockfile                 = true
skip_s3_checksum             = true
skip_credentials_validation = true
skip_metadata_api_check     = true
skip_region_validation      = true
skip_requesting_account_id  = true
`
}

export function stateKeyForRoot(rootName) {
  return `${rootName === 'foundation' ? 'production' : rootName}/terraform.tfstate`
}

export function backendEnvironment(stateConfig, baseEnvironment = process.env) {
  const accessKey = stateConfig.TF_STATE_ACCESS_KEY_ID?.trim()
  const secretKey = stateConfig.TF_STATE_SECRET_ACCESS_KEY?.trim()
  if (!accessKey || !secretKey) {
    throw new Error(
      'Both state backend credentials are required; run infra:bootstrap first',
    )
  }

  return s3CredentialEnvironment(
    { accessKey, secretKey },
    baseEnvironment,
  )
}

export function s3CredentialEnvironment(
  { accessKey, secretKey },
  baseEnvironment = process.env,
) {
  const {
    AWS_SESSION_TOKEN: _sessionToken,
    AWS_SECURITY_TOKEN: _securityToken,
    ...environment
  } = baseEnvironment

  return {
    ...environment,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
  }
}

export function githubRepositoryFromRemoteUrl(remoteUrl) {
  const value = String(remoteUrl ?? '')
    .trim()
    .replace(/\/$/, '')
    .replace(/\.git$/i, '')
  let repository

  if (/^git@github\.com:/i.test(value)) {
    repository = value.replace(/^git@github\.com:/i, '')
  } else if (/^ssh:\/\/git@github\.com\//i.test(value)) {
    repository = value.replace(/^ssh:\/\/git@github\.com\//i, '')
  } else {
    try {
      const url = new URL(value)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.hostname.toLowerCase() !== 'github.com'
      ) {
        return null
      }
      repository = url.pathname.replace(/^\//, '')
    } catch {
      return null
    }
  }

  const segments = repository.split('/')
  if (segments.length !== 2 || segments.some((segment) => !segment.trim()))
    return null
  return segments.map((segment) => segment.toLowerCase()).join('/')
}

export function releaseGitProblems({
  dirtyLines,
  currentBranch,
  configuredBranch,
  upstreamRef,
  headCommit,
  upstreamCommit,
  configuredGithubRepo,
  upstreamGithubRepo,
  githubRepositoryRequired = false,
  expectedCommit,
}) {
  const problems = []

  if (!configuredBranch) {
    problems.push(
      'Terraform foundation state does not identify the configured release branch; run bun run infra:apply for the selected provider',
    )
  } else if (!currentBranch) {
    problems.push('release requires a named branch, not a detached checkout')
  } else if (currentBranch !== configuredBranch) {
    problems.push(
      `current checkout is ${currentBranch}, but Terraform deploys ${configuredBranch}`,
    )
  }

  const upstreamBranch = upstreamRef?.includes('/')
    ? upstreamRef.slice(upstreamRef.indexOf('/') + 1)
    : null
  if (!upstreamRef) {
    problems.push('release branch must track a pushed upstream')
  } else if (configuredBranch && upstreamBranch !== configuredBranch) {
    problems.push(
      `release upstream is ${upstreamRef}, but Terraform deploys branch ${configuredBranch}`,
    )
  }

  if (
    !expectedCommit &&
    (!headCommit || !upstreamCommit || headCommit !== upstreamCommit)
  ) {
    problems.push(
      'release HEAD must exactly match the freshly fetched upstream commit',
    )
  }
  if (expectedCommit && headCommit !== expectedCommit) {
    problems.push(
      `release source changed after preflight: expected ${expectedCommit}, found ${headCommit || 'no HEAD'}`,
    )
  }

  if (githubRepositoryRequired && !configuredGithubRepo) {
    problems.push(
      'Terraform foundation state does not identify the configured GitHub repository; run bun run infra:apply for digitalocean',
    )
  } else if (configuredGithubRepo) {
    if (!upstreamGithubRepo) {
      problems.push('release upstream must be a supported GitHub remote')
    } else if (
      configuredGithubRepo.toLowerCase() !== upstreamGithubRepo.toLowerCase()
    ) {
      problems.push(
        `release upstream repository is ${upstreamGithubRepo}, but Terraform deploys ${configuredGithubRepo}`,
      )
    }
  }

  if (dirtyLines.length > 0) {
    const preview = dirtyLines.slice(0, 8).join('\n')
    const suffix =
      dirtyLines.length > 8 ? `\n...and ${dirtyLines.length - 8} more` : ''
    problems.push(`release requires a clean worktree:\n${preview}${suffix}`)
  }

  return problems
}

export async function withProductionMutationLease(acquire, operation) {
  const lease = await acquire()
  let result
  let operationError
  try {
    await lease.assertHeld?.()
    result = await operation(lease)
    await lease.assertHeld?.()
  } catch (error) {
    operationError = error
  }

  try {
    await lease.release()
  } catch (releaseError) {
    if (!operationError) throw releaseError
  }
  if (operationError) throw operationError
  return result
}

export function productionMutationNeedsLease(options) {
  if (options.dryRun) return false
  if (options.command === 'apply' || options.command === 'release') return true
  return options.command === 'import' && options.rootName !== 'bootstrap'
}

async function assertProductionMutationLease(options) {
  await options.mutationLease?.assertHeld?.()
}

export async function yieldToProcessEvents() {
  await new Promise((resolveTurn) => setTimeout(resolveTurn, 0))
}

export function bootstrapStateMode({
  hasStateEnvironment,
  hasLocalState,
  newBootstrap = false,
  recoverExisting = false,
}) {
  if (recoverExisting) return 'recover'
  if (!hasStateEnvironment && hasLocalState) return 'local'
  if (!hasStateEnvironment && newBootstrap) return 'local'
  if (!hasStateEnvironment) return 'ambiguous'
  return hasLocalState ? 'migrate' : 'remote'
}

export function stateRecoveryOutputs(
  { bucket, region },
  environment = process.env,
) {
  const accessKey = environment.TF_STATE_RECOVERY_ACCESS_KEY_ID?.trim()
  const secretKey = environment.TF_STATE_RECOVERY_SECRET_ACCESS_KEY?.trim()
  if (!bucket?.trim() || !region?.trim()) {
    throw new Error(
      'State recovery requires both --recover-state-bucket and --recover-state-region',
    )
  }
  if (!accessKey || !secretKey) {
    throw new Error(
      'State recovery requires TF_STATE_RECOVERY_ACCESS_KEY_ID and TF_STATE_RECOVERY_SECRET_ACCESS_KEY',
    )
  }
  return {
    state_bucket: bucket.trim(),
    state_region: region.trim(),
    state_access_key_id: accessKey,
    state_secret_access_key: secretKey,
  }
}

const safeOutputNames = {
  digitalocean: [
    'api_url',
    'webapp_url',
    'website_url',
    'media_bucket',
    'media_endpoint',
    'registry',
    'image_repository',
    'runtime_image_digest',
    'release_revision',
  ],
  yandex: [
    'registry_id',
    'image_repository',
    'migration_container_name',
    'migration_container_url',
    'migration_image_digest',
    'runtime_image_digest',
    'database_credential_slot',
    'api_url',
    'webapp_url',
    'website_url',
    'media_bucket',
    'webapp_bucket',
    'website_bucket',
    'required_dns_records',
    'direct_static_dns_records',
    'cdn_dns_records',
  ],
}

export function yandexDatabaseRotationProblems({
  current,
  liveSlot,
  desired,
}) {
  if (!liveSlot) return []
  if (!['blue', 'green'].includes(liveSlot)) {
    return [`the live runtime reports unknown database credential slot ${liveSlot}`]
  }
  if (
    !current?.versions ||
    !current?.fingerprints ||
    !current.fingerprints.jwt
  ) {
    return [
      `the live runtime reports database slot ${liveSlot}, but foundation rotation metadata is missing; import or reconcile state before changing credentials`,
    ]
  }

  if (
    desired?.versions?.[liveSlot] !== current.versions[liveSlot] ||
    desired?.fingerprints?.[liveSlot] !== current.fingerprints[liveSlot]
  ) {
    return [
      `database credential slot ${liveSlot} is still used by the live runtime; rotate only the inactive slot before switching`,
    ]
  }
  if (desired?.fingerprints?.jwt !== current.fingerprints.jwt) {
    return [
      'JWT_SECRET is present in both persistent runtime slot versions; rotate it only after implementing an application key-overlap flow',
    ]
  }
  return []
}

export function yandexRuntimeStateProblems({
  foundationMetadata,
  deployedContainerNames,
  projectSlug,
}) {
  if (!foundationMetadata) return []

  const prefix = `${projectSlug}-prod-`
  const migrationName = `${prefix}migration`
  const runtimeNames = [
    ...new Set(
      (deployedContainerNames ?? []).filter(
        (name) =>
          typeof name === 'string' &&
          name.startsWith(prefix) &&
          name !== migrationName,
      ),
    ),
  ].sort()
  if (runtimeNames.length === 0) return []

  return [
    `Yandex runtime state has no credential slot, but deployed runtime containers still exist: ${runtimeNames.join(', ')}. Recover or import the runtime state before changing foundation credentials.`,
  ]
}

export function safeYandexSecretVersionDestroyAddresses(liveSlot) {
  const slots = ['blue', 'green']
  const inactiveSlots = liveSlot
    ? slots.filter((slot) => slot !== liveSlot)
    : slots
  return [
    ...inactiveSlots.map(
      (slot) => `yandex_lockbox_secret_version_hashed.runtime["${slot}"]`,
    ),
    'yandex_lockbox_secret_version_hashed.migration_database',
  ]
}

export function protectedYandexSecretVersionDestroyAddresses(liveSlot) {
  if (!liveSlot) return []
  if (!['blue', 'green'].includes(liveSlot)) {
    throw new Error(`Unknown Yandex database credential slot: ${liveSlot}`)
  }
  return [`yandex_lockbox_secret_version_hashed.runtime["${liveSlot}"]`]
}

const yandexFoundationCleanupAddresses = [
  'yandex_resourcemanager_folder_iam_member.storage_manager[0]',
]

const yandexMigrationSeedCleanupAddresses = [
  'yandex_lockbox_secret.admin_seed[0]',
  'yandex_lockbox_secret_version_hashed.admin_seed[0]',
  'yandex_lockbox_secret_iam_member.admin_seed[0]',
]

export function safeYandexFoundationDestroyAddresses() {
  return [...yandexFoundationCleanupAddresses]
}

export function safeYandexMigrationSeedDestroyAddresses() {
  return [...yandexMigrationSeedCleanupAddresses]
}

export function safeTerraformOutputs(provider, outputs) {
  const names = safeOutputNames[provider]
  if (!names) throw new Error(`Unsupported provider: ${provider}`)

  return Object.fromEntries(
    names
      .filter((name) => Object.hasOwn(outputs, name))
      .map((name) => [name, outputs[name]]),
  )
}

export function planSafetyProblems(
  plan,
  allowedDestroyAddresses = [],
  protectedDestroyAddresses = [],
) {
  const allowed = new Set(allowedDestroyAddresses)
  const protectedAddresses = new Set(protectedDestroyAddresses)
  const problems = []

  for (const resource of plan?.resource_changes ?? []) {
    const actions = resource?.change?.actions ?? []
    if (!actions.includes('delete')) continue

    const address = resource.address
    const operation = actions.includes('create') ? 'replaced' : 'deleted'
    const protectedResource =
      protectedAddresses.has(address) ||
      protectedResourcePatterns.some((pattern) => pattern.test(address))

    if (protectedResource) {
      problems.push(
        `${address} is protected and would be ${operation}; this release path refuses it`,
      )
    } else if (!allowed.has(address)) {
      problems.push(
        `${address} would be ${operation}; pass --allow-destroy=${address} only after reviewing that exact resource`,
      )
    }
  }

  return problems
}

export function digestFromRepoDigests(repoDigests, repository) {
  const prefix = `${repository}@`
  const candidates = (repoDigests ?? [])
    .filter((entry) => typeof entry === 'string' && entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length))
    .filter((digest) => /^sha256:[0-9a-f]{64}$/.test(digest))

  if (candidates.length !== 1) {
    throw new Error(
      `Could not resolve one immutable digest for ${repository} after push`,
    )
  }
  return candidates[0]
}

export function redactArguments(args) {
  const redactNextFlags = new Set([
    '-var',
    '--header',
    '--password',
    '--token',
    '--secret',
    '--secret-key',
    '--access-key',
    '--access-token',
  ])
  let redactNext = false

  return args.map((argument) => {
    if (redactNext) {
      redactNext = false
      return '[REDACTED]'
    }
    if (redactNextFlags.has(argument)) {
      redactNext = true
      return argument
    }
    if (/authorization\s*:/i.test(argument)) return '[REDACTED]'
    if (/(password|secret|token|access[_-]?key)[^=]*=/i.test(argument)) {
      return `${argument.slice(0, argument.indexOf('=') + 1)}[REDACTED]`
    }
    return argument
  })
}

export function digitalOceanCliEnvironment(source = process.env) {
  const token = source.DIGITALOCEAN_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'DIGITALOCEAN_TOKEN is required for both Terraform and doctl',
    )
  }

  return {
    ...source,
    // doctl otherwise prefers the currently selected saved context. Force its documented default
    // context and map Terraform's token into doctl's own environment variable so every provider
    // and CLI operation is authorized by the same credential.
    DIGITALOCEAN_ACCESS_TOKEN: token,
    DIGITALOCEAN_CONTEXT: 'default',
  }
}

export function digitalOceanSpacesKeyProblems(rawResponse, expectedAccessKey) {
  let parsed
  try {
    parsed = JSON.parse(rawResponse)
  } catch {
    return ['DigitalOcean returned invalid JSON for the Spaces key']
  }

  const candidates = [
    ...(Array.isArray(parsed) ? parsed : []),
    ...(Array.isArray(parsed?.keys) ? parsed.keys : []),
    parsed?.key,
    parsed,
  ].filter((candidate) => candidate && typeof candidate === 'object')
  const returnedAccessKey = candidates
    .map(
      (candidate) =>
        candidate.access_key ??
        candidate.accessKey ??
        candidate.AccessKey ??
        candidate['Access Key'] ??
        candidate['Access Key ID'],
    )
    .find((value) => typeof value === 'string' && value.length > 0)

  if (!returnedAccessKey) {
    return ['the DigitalOcean response contains no Spaces access key']
  }
  if (returnedAccessKey !== expectedAccessKey) {
    return ['the returned Spaces key does not match SPACES_ACCESS_KEY_ID']
  }
  return []
}

export function digitalOceanTeamIdentityProblems(
  rawResponse,
  expectedTeamUuid,
) {
  let parsed
  try {
    parsed = JSON.parse(rawResponse)
  } catch {
    return ['DigitalOcean returned invalid JSON for the account identity']
  }
  const account = Array.isArray(parsed) ? parsed[0] : parsed
  const actualTeamUuid =
    account?.team?.uuid ??
    account?.Team?.UUID ??
    account?.team_uuid ??
    account?.TeamUUID
  if (!actualTeamUuid) {
    return ['DigitalOcean account response contains no immutable team UUID']
  }
  if (actualTeamUuid !== expectedTeamUuid) {
    return [
      `DigitalOcean token belongs to team UUID ${actualTeamUuid}, expected ${expectedTeamUuid}`,
    ]
  }
  return []
}

export function staticUploadSteps({
  distDirectory,
  bucket,
  immutableDirectory,
}) {
  const common = [
    '--endpoint-url',
    'https://storage.yandexcloud.net',
    's3',
    'sync',
    distDirectory,
    `s3://${bucket}`,
    '--only-show-errors',
  ]

  return [
    {
      command: 'aws',
      args: [
        ...common,
        '--exclude',
        '*',
        '--include',
        `${immutableDirectory}/*`,
        '--cache-control',
        'public,max-age=31536000,immutable',
      ],
    },
    {
      command: 'aws',
      args: [
        ...common,
        '--exclude',
        `${immutableDirectory}/*`,
        '--delete',
        '--cache-control',
        'public,max-age=0,must-revalidate',
      ],
    },
  ]
}

export function writeYandexStaticReleaseMarkers(artifactRoot, commit) {
  for (const surface of ['webapp', 'website']) {
    const markerDirectory = resolve(artifactRoot, surface, '.well-known')
    mkdirSync(markerDirectory, { recursive: true })
    writeFileSync(resolve(markerDirectory, 'release-revision'), `${commit}\n`)
  }
}

export function sanitizedBuildEnvironment(source = process.env) {
  const secretNames = [
    /^TF_VAR_/,
    /^DIGITALOCEAN_TOKEN$/,
    /^SPACES_/,
    /^AWS_/,
    /^YC_TOKEN$/,
    /^YC_SERVICE_ACCOUNT_KEY_FILE$/,
    /^ADMIN_SEED_/,
    /^DATABASE_URL$/,
    /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)(?:_|$)/,
  ]

  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) => !secretNames.some((pattern) => pattern.test(key)),
    ),
  )
}

function shellDisplay(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value)
}

function runCommand(
  command,
  args,
  {
    cwd = repoRoot,
    env = process.env,
    capture = false,
    okStatuses = [0],
    sensitiveOutput = false,
    log = true,
    input,
  } = {},
) {
  if (log) {
    console.log(
      `[infra] ${[command, ...redactArguments(args)].map(shellDisplay).join(' ')}`,
    )
  }

  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    input,
    stdio: capture
      ? [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
      : input === undefined
        ? 'inherit'
        : ['pipe', 'inherit', 'inherit'],
  })

  if (result.error?.code === 'ENOENT') {
    throw new Error(`${command} is not installed or is not available on PATH`)
  }
  if (result.error) throw result.error
  if (!okStatuses.includes(result.status ?? 1)) {
    const detail = sensitiveOutput
      ? ''
      : String(result.stderr || result.stdout || '')
          .trim()
          .slice(0, 2_000)
    throw new Error(
      `${command} ${args[0] ?? ''} failed with status ${result.status ?? 1}${detail ? `:\n${detail}` : ''}`,
    )
  }

  return capture ? String(result.stdout ?? '') : ''
}

function runDigitalOceanCli(args, options = {}) {
  return runCommand('doctl', ['--context', 'default', ...args], {
    ...options,
    env: digitalOceanCliEnvironment(options.env ?? process.env),
  })
}

function gitArchive(commit) {
  const result = spawnSync('git', ['archive', '--format=tar', commit], {
    cwd: repoRoot,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `git archive failed with status ${result.status ?? 1}: ${String(result.stderr ?? '').trim()}`,
    )
  }
  return result.stdout
}

function readTfvars(root) {
  const path = resolve(root, 'terraform.tfvars')
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing. Copy terraform.tfvars.example to terraform.tfvars and fill it in first.`,
    )
  }
  return parseSimpleAssignments(readFileSync(path, 'utf8'))
}

function readStateEnvironment(path) {
  if (!existsSync(path)) {
    throw new Error(
      `Remote state is not configured at ${path}; run infra:bootstrap first`,
    )
  }
  return parseEnvironmentFile(readFileSync(path, 'utf8'))
}

function writePrivateFile(path, contents) {
  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

function writeJsonFile(path, value) {
  writePrivateFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function removeLocalBootstrapState(root) {
  for (const name of ['terraform.tfstate', 'terraform.tfstate.backup']) {
    const path = resolve(root, name)
    if (existsSync(path)) rmSync(path)
  }
}

function terraformInit(root, env, extra = []) {
  runCommand('terraform', ['init', '-input=false', ...extra], {
    cwd: root,
    env: { ...terraformEnvironment, ...env },
  })
  runCommand('terraform', ['validate'], {
    cwd: root,
    env: { ...terraformEnvironment, ...env },
  })
}

function terraformOutputs(root, env) {
  const output = runCommand('terraform', ['output', '-json'], {
    cwd: root,
    env: { ...terraformEnvironment, ...env },
    capture: true,
    sensitiveOutput: true,
    log: false,
  }).trim()
  if (!output) return {}

  const parsed = JSON.parse(output)
  return Object.fromEntries(
    Object.entries(parsed).map(([key, metadata]) => [key, metadata?.value]),
  )
}

function terraformPlan({
  root,
  env,
  apply,
  allowedDestroyAddresses,
  protectedDestroyAddresses = [],
  label,
  requireNoChanges = false,
}) {
  const scratchParent = resolve(repoRoot, '.scratch', 'infra-plans')
  mkdirSync(scratchParent, { recursive: true })
  const planDirectory = mkdtempSync(resolve(scratchParent, `${label}-`))
  const planPath = resolve(planDirectory, 'terraform.tfplan')

  try {
    const planStatus = spawnSync(
      'terraform',
      [
        'plan',
        '-input=false',
        '-lock-timeout=60s',
        '-detailed-exitcode',
        `-out=${planPath}`,
      ],
      {
        cwd: root,
        env: { ...terraformEnvironment, ...env },
        stdio: 'inherit',
      },
    )
    if (planStatus.error?.code === 'ENOENT') {
      throw new Error('terraform is not installed or is not available on PATH')
    }
    if (![0, 2].includes(planStatus.status ?? 1)) {
      throw new Error(
        `terraform plan failed with status ${planStatus.status ?? 1}`,
      )
    }

    const plan = JSON.parse(
      runCommand('terraform', ['show', '-json', planPath], {
        cwd: root,
        env: { ...terraformEnvironment, ...env },
        capture: true,
        sensitiveOutput: true,
        log: false,
      }),
    )
    const safetyProblems = planSafetyProblems(
      plan,
      allowedDestroyAddresses,
      protectedDestroyAddresses,
    )
    if (safetyProblems.length > 0) {
      throw new Error(
        `Terraform plan was refused:\n- ${safetyProblems.join('\n- ')}`,
      )
    }

    const hasChanges = planStatus.status === 2
    if (requireNoChanges && hasChanges) {
      throw new Error(
        `${label} has unapplied changes; run bun run infra:apply -- ${label.split('-')[0]} before releasing`,
      )
    }

    if (!apply) {
      console.log(
        `[infra] ${label}: plan checked; no cloud changes were applied.`,
      )
      return { hasChanges }
    }

    runCommand('terraform', ['apply', '-input=false', planPath], {
      cwd: root,
      env: { ...terraformEnvironment, ...env },
    })
    return { hasChanges }
  } finally {
    rmSync(planDirectory, { recursive: true, force: true })
  }
}

function assertEnvironmentKeys(keys) {
  const missing = keys.filter((key) => !process.env[key]?.trim())
  if (missing.length > 0)
    throw new Error(`Missing required environment: ${missing.join(', ')}`)
}

function assertProviderIdentity(provider, tfvars) {
  if (provider === 'digitalocean') {
    assertEnvironmentKeys([
      'DIGITALOCEAN_TOKEN',
      'DO_EXPECTED_TEAM_UUID',
      'SPACES_ACCESS_KEY_ID',
      'SPACES_SECRET_ACCESS_KEY',
    ])
    const rawAccount = runDigitalOceanCli(
      ['account', 'get', '--output', 'json'],
      { capture: true, sensitiveOutput: true, log: false },
    )
    const teamProblems = digitalOceanTeamIdentityProblems(
      rawAccount,
      process.env.DO_EXPECTED_TEAM_UUID.trim(),
    )
    if (teamProblems.length > 0) {
      throw new Error(
        `DigitalOcean account verification failed: ${teamProblems.join('; ')}`,
      )
    }
    const spacesAccessKey = process.env.SPACES_ACCESS_KEY_ID.trim()
    let rawSpacesKey
    try {
      rawSpacesKey = runDigitalOceanCli(
        ['spaces', 'keys', 'get', spacesAccessKey, '--output', 'json'],
        {
          capture: true,
          sensitiveOutput: true,
          log: false,
        },
      )
    } catch {
      throw new Error(
        'DIGITALOCEAN_TOKEN cannot read SPACES_ACCESS_KEY_ID in the expected team; use matching credentials and grant spaces_key:read',
      )
    }
    const spacesKeyProblems = digitalOceanSpacesKeyProblems(
      rawSpacesKey,
      spacesAccessKey,
    )
    if (spacesKeyProblems.length > 0) {
      throw new Error(
        `DigitalOcean Spaces credential verification failed: ${spacesKeyProblems.join('; ')}`,
      )
    }
    return
  }

  const expectedCloud = String(tfvars.cloud_id ?? '').trim()
  const expectedFolder = String(tfvars.folder_id ?? '').trim()
  if (
    !expectedCloud ||
    !expectedFolder ||
    expectedCloud.startsWith('REPLACE_WITH_')
  ) {
    throw new Error(
      'Set real cloud_id and folder_id in terraform.tfvars before using Yandex Cloud',
    )
  }
  const currentCloud = runCommand('yc', ['config', 'get', 'cloud-id'], {
    capture: true,
  }).trim()
  const currentFolder = runCommand('yc', ['config', 'get', 'folder-id'], {
    capture: true,
  }).trim()
  if (currentCloud !== expectedCloud || currentFolder !== expectedFolder) {
    throw new Error(
      `yc targets cloud/folder ${currentCloud}/${currentFolder}, expected ${expectedCloud}/${expectedFolder}`,
    )
  }
}

function assertBackendOutputs(outputs) {
  const required = [
    'state_bucket',
    'state_region',
    'state_access_key_id',
    'state_secret_access_key',
  ]
  const missing = required.filter((key) => !String(outputs[key] ?? '').trim())
  if (missing.length > 0) {
    throw new Error(
      `Bootstrap did not return required state outputs: ${missing.join(', ')}`,
    )
  }
}

function writeBackendConfiguration(provider, outputs, paths) {
  assertBackendOutputs(outputs)

  for (const [rootName, root] of Object.entries(paths.roots)) {
    writePrivateFile(
      resolve(root, 'backend.backend.hcl'),
      renderBackendConfig(provider, {
        bucket: outputs.state_bucket,
        region: outputs.state_region,
        key: stateKeyForRoot(rootName),
      }),
    )
  }
}

function writeBackendArtifacts(provider, outputs, paths) {
  // Backend files must exist before the credential marker: an interrupted write can then safely
  // rerun locally, whereas credentials without configuration used to look like a ready backend.
  writeBackendConfiguration(provider, outputs, paths)

  writePrivateFile(
    paths.stateEnvironment,
    [
      '# Generated by scripts/infra.mjs. Do not commit or print this file.',
      `TF_STATE_ACCESS_KEY_ID=${JSON.stringify(outputs.state_access_key_id)}`,
      `TF_STATE_SECRET_ACCESS_KEY=${JSON.stringify(outputs.state_secret_access_key)}`,
      '',
    ].join('\n'),
  )
}

function writeOperationsBackendConfiguration(paths) {
  const foundationConfiguration = resolve(
    paths.productionRoot,
    'backend.backend.hcl',
  )
  if (!existsSync(foundationConfiguration)) {
    throw new Error(
      `Remote backend configuration is missing at ${foundationConfiguration}; run infra:bootstrap first`,
    )
  }

  const current = readFileSync(foundationConfiguration, 'utf8')
  const operations = current.replace(
    /^key\s*=\s*.+$/m,
    `key    = ${JSON.stringify(stateKeyForRoot('operations'))}`,
  )
  if (operations === current) {
    throw new Error(
      `Remote backend configuration at ${foundationConfiguration} contains no state key`,
    )
  }
  writePrivateFile(
    resolve(paths.roots.operations, 'backend.backend.hcl'),
    operations,
  )
}

function boundedProcessOutput(current, chunk) {
  return `${current}${String(chunk)}`.slice(-16_000)
}

async function acquireProductionMutationLease(provider) {
  const paths = providerPaths(provider)
  const scratchParent = resolve(repoRoot, '.scratch', 'infra-leases')
  mkdirSync(scratchParent, { recursive: true })
  const leaseDirectory = mkdtempSync(resolve(scratchParent, `${provider}-`))
  const readySignal = resolve(leaseDirectory, 'ready')
  const releaseSignal = resolve(leaseDirectory, 'release')
  const terraformDataDirectory = resolve(leaseDirectory, 'terraform-data')
  const owner = randomUUID()
  let child

  try {
    writeOperationsBackendConfiguration(paths)
    const env = {
      ...backendEnvironment(
        readStateEnvironment(paths.stateEnvironment),
        terraformEnvironment,
      ),
      TF_DATA_DIR: terraformDataDirectory,
    }
    terraformInit(paths.roots.operations, env, [
      '-reconfigure',
      '-backend-config=backend.backend.hcl',
    ])

    const holderScript = resolve(
      repoRoot,
      'scripts',
      'infra-lease-holder.mjs',
    )
    child = spawn(
      'terraform',
      [
        'apply',
        '-auto-approve',
        '-input=false',
        '-lock-timeout=1s',
        `-var=owner_token=${owner}`,
        `-var=holder_executable=${process.execPath}`,
        `-var=holder_script=${holderScript}`,
        `-var=ready_signal=${readySignal}`,
        `-var=release_signal=${releaseSignal}`,
        `-var=parent_pid=${process.pid}`,
      ],
      {
        cwd: paths.roots.operations,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout = boundedProcessOutput(stdout, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = boundedProcessOutput(stderr, chunk)
    })

    let settled = false
    const completion = new Promise((resolveCompletion) => {
      const settle = (value) => {
        if (settled) return
        settled = true
        resolveCompletion(value)
      }
      child.once('error', (error) => settle({ error }))
      child.once('close', (code, signal) => settle({ code, signal }))
    })

    const deadline = Date.now() + 30_000
    while (!existsSync(readySignal)) {
      const outcome = await Promise.race([
        completion,
        new Promise((resolveWait) =>
          setTimeout(() => resolveWait(null), 100),
        ),
      ])
      if (outcome) {
        const detail = String(stderr || stdout).trim().slice(-4_000)
        throw new Error(
          `Could not acquire the ${provider} production mutation lease${detail ? `:\n${detail}` : ''}\nAnother mutation may be active. Use the Terraform Lock Info ID for infra/${provider}/operations only after confirming its holder is no longer running.`,
        )
      }
      if (Date.now() >= deadline) {
        child.kill('SIGTERM')
        await completion
        throw new Error(
          `Timed out while acquiring the ${provider} production mutation lease`,
        )
      }
    }
    if (readFileSync(readySignal, 'utf8') !== owner) {
      child.kill('SIGTERM')
      await completion
      throw new Error(
        `The ${provider} production mutation lease returned an invalid owner token`,
      )
    }

    const assertHeld = async () => {
      await yieldToProcessEvents()
      if (settled) {
        throw new Error(
          `The ${provider} production mutation lease was lost before the operation completed`,
        )
      }
    }
    return {
      assertHeld,
      async release() {
        try {
          await assertHeld()
          writePrivateFile(releaseSignal, owner)
          const outcome = await completion
          if (outcome.error || outcome.code !== 0) {
            const detail = String(stderr || stdout).trim().slice(-4_000)
            throw new Error(
              `Could not release the ${provider} production mutation lease${detail ? `:\n${detail}` : ''}`,
            )
          }
        } finally {
          rmSync(leaseDirectory, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    if (child && !child.killed) child.kill('SIGTERM')
    rmSync(leaseDirectory, { recursive: true, force: true })
    throw error
  }
}

export function prepareStateRecoveryAccess(
  { provider, outputs, paths, baseEnvironment = terraformEnvironment },
  operations = {},
) {
  const writeConfiguration =
    operations.writeConfiguration ?? writeBackendConfiguration
  writeConfiguration(provider, outputs, paths)

  // Temporary recovery credentials deliberately stay in process memory. Persisting them in the
  // ready-marker file would make an interrupted recovery look complete and block the documented
  // retry path before Terraform has reconciled the managed state key.
  return backendEnvironment(
    {
      TF_STATE_ACCESS_KEY_ID: outputs.state_access_key_id,
      TF_STATE_SECRET_ACCESS_KEY: outputs.state_secret_access_key,
    },
    baseEnvironment,
  )
}

export function finalizeStateRecovery(
  {
    provider,
    paths,
    managedOutputs,
    expectedStateBucket,
    baseEnvironment = terraformEnvironment,
  },
  operations = {},
) {
  const managedEnvironment = backendEnvironment(
    {
      TF_STATE_ACCESS_KEY_ID: managedOutputs.state_access_key_id,
      TF_STATE_SECRET_ACCESS_KEY: managedOutputs.state_secret_access_key,
    },
    baseEnvironment,
  )
  const verifyBootstrap =
    operations.verifyBootstrap ??
    (() =>
      prepareBootstrapBackend({
        provider,
        paths,
        stateMode: 'remote',
        dryRun: false,
        remoteEnvironment: managedEnvironment,
        expectedStateBucket,
      }))
  const initializeRoot =
    operations.initializeRoot ??
    ((_rootName, root) =>
      terraformInit(root, managedEnvironment, [
        '-reconfigure',
        '-backend-config=backend.backend.hcl',
      ]))
  const writeArtifacts = operations.writeArtifacts ?? writeBackendArtifacts

  verifyBootstrap()
  for (const [rootName, root] of Object.entries(paths.roots)) {
    if (rootName === 'bootstrap') continue
    initializeRoot(rootName, root)
  }
  // This file is the ready marker used by bootstrapStateMode. Persist it only after the managed
  // credentials have successfully opened every backend, so any earlier interruption remains
  // safely retryable with --recover-state-*.
  writeArtifacts(provider, managedOutputs, paths)
  return managedEnvironment
}

export function prepareBootstrapBackend(
  {
    provider,
    paths,
    stateMode,
    dryRun,
    remoteEnvironment,
    expectedStateBucket,
  },
  operations = {},
) {
  const initialize = operations.initialize ?? terraformInit
  const readOutputs = operations.readOutputs ?? terraformOutputs
  const removeLocalState =
    operations.removeLocalState ?? removeLocalBootstrapState
  const writeArtifacts = operations.writeArtifacts ?? writeBackendArtifacts

  if (stateMode === 'migrate') {
    if (dryRun) return { migrationPending: true, outputs: null }

    initialize(paths.bootstrapRoot, remoteEnvironment, [
      '-migrate-state',
      '-force-copy',
      '-backend-config=backend.backend.hcl',
    ])
    const outputs = readOutputs(paths.bootstrapRoot, remoteEnvironment)
    assertBackendOutputs(outputs)
    if (expectedStateBucket && outputs.state_bucket !== expectedStateBucket) {
      throw new Error(
        'Remote bootstrap state verification returned a different state bucket',
      )
    }
    removeLocalState(paths.bootstrapRoot)
    writeArtifacts(provider, outputs, paths)
    return { migrationPending: false, outputs }
  }

  if (stateMode !== 'remote') {
    throw new Error(`Unsupported remote bootstrap state mode: ${stateMode}`)
  }

  initialize(paths.bootstrapRoot, remoteEnvironment, [
    '-reconfigure',
    '-backend-config=backend.backend.hcl',
  ])
  const outputs = readOutputs(paths.bootstrapRoot, remoteEnvironment)
  // Never plan against a newly initialized empty backend merely because a credential file
  // exists. The bootstrap resources themselves must already be present in remote state.
  assertBackendOutputs(outputs)
  if (expectedStateBucket && outputs.state_bucket !== expectedStateBucket) {
    throw new Error(
      'Remote bootstrap state verification returned a different state bucket',
    )
  }
  return { migrationPending: false, outputs }
}

async function bootstrap(provider, options) {
  const paths = providerPaths(provider)
  const tfvars = readTfvars(paths.bootstrapRoot)
  assertProviderIdentity(provider, tfvars)

  if (
    options.newBootstrap &&
    (existsSync(paths.stateEnvironment) ||
      existsSync(resolve(paths.bootstrapRoot, 'terraform.tfstate')))
  ) {
    throw new Error(
      '--new is accepted only when neither generated remote-state credentials nor local bootstrap state exists.',
    )
  }

  const stateMode = bootstrapStateMode({
    hasStateEnvironment: existsSync(paths.stateEnvironment),
    hasLocalState: existsSync(
      resolve(paths.bootstrapRoot, 'terraform.tfstate'),
    ),
    newBootstrap: options.newBootstrap,
    recoverExisting: Boolean(options.recoverStateBucket),
  })
  const bootstrapAccessPath = resolve(
    paths.bootstrapRoot,
    'bootstrap-access.auto.tfvars.json',
  )
  if (stateMode === 'ambiguous') {
    throw new Error(
      'No local or configured remote state was found. Pass --new for a verified first bootstrap, or use the documented --recover-state-* reattach flow for existing infrastructure.',
    )
  }
  if (stateMode === 'recover') {
    if (
      existsSync(paths.stateEnvironment) ||
      existsSync(resolve(paths.bootstrapRoot, 'terraform.tfstate'))
    ) {
      throw new Error(
        'State recovery requires an absent generated state environment and no local bootstrap state; preserve and reconcile the existing files instead of overwriting them.',
      )
    }
    if (options.dryRun) {
      throw new Error(
        'State recovery does not support --dry-run because it must verify and replace temporary backend credentials atomically.',
      )
    }

    const recoveryOutputs = stateRecoveryOutputs({
      bucket: options.recoverStateBucket,
      region: options.recoverStateRegion,
    })
    const recoveryEnvironment = prepareStateRecoveryAccess({
      provider,
      outputs: recoveryOutputs,
      paths,
    })
    prepareBootstrapBackend({
      provider,
      paths,
      stateMode: 'remote',
      dryRun: false,
      remoteEnvironment: recoveryEnvironment,
      expectedStateBucket: recoveryOutputs.state_bucket,
    })
    terraformPlan({
      root: paths.bootstrapRoot,
      env: recoveryEnvironment,
      apply: true,
      allowedDestroyAddresses: options.allowedDestroyAddresses,
      label: `${provider}-bootstrap-recovery`,
    })

    const managedOutputs = terraformOutputs(
      paths.bootstrapRoot,
      recoveryEnvironment,
    )
    finalizeStateRecovery({
      provider,
      paths,
      managedOutputs,
      expectedStateBucket: recoveryOutputs.state_bucket,
    })
    console.log(
      `[infra] ${provider}: existing remote state reattached and managed backend credentials verified. Revoke the temporary recovery key now.`,
    )
    return
  }
  if (stateMode === 'local') {
    if (provider === 'yandex') {
      writeJsonFile(bootstrapAccessPath, {
        bootstrap_folder_storage_access: true,
      })
    }
    terraformInit(paths.bootstrapRoot, process.env, ['-backend=false'])
    try {
      terraformPlan({
        root: paths.bootstrapRoot,
        env: process.env,
        apply: !options.dryRun,
        allowedDestroyAddresses: options.allowedDestroyAddresses,
        label: `${provider}-bootstrap-local`,
      })
    } finally {
      if (options.dryRun && existsSync(bootstrapAccessPath))
        rmSync(bootstrapAccessPath)
    }
    if (options.dryRun) return

    if (provider === 'yandex') {
      writeJsonFile(bootstrapAccessPath, {
        bootstrap_folder_storage_access: false,
      })
      terraformPlan({
        root: paths.bootstrapRoot,
        env: process.env,
        apply: true,
        allowedDestroyAddresses: [
          ...options.allowedDestroyAddresses,
          'yandex_resourcemanager_folder_iam_member.terraform_state_storage[0]',
        ],
        label: 'yandex-bootstrap-tighten-state-access',
      })
      rmSync(bootstrapAccessPath)
    }

    const localOutputs = terraformOutputs(paths.bootstrapRoot, process.env)
    writeBackendArtifacts(provider, localOutputs, paths)
    const remoteEnvironment = backendEnvironment(
      readStateEnvironment(paths.stateEnvironment),
      terraformEnvironment,
    )

    prepareBootstrapBackend({
      provider,
      paths,
      stateMode: 'migrate',
      dryRun: false,
      remoteEnvironment,
      expectedStateBucket: localOutputs.state_bucket,
    })
    for (const rootName of providerRootNames[provider]) {
      terraformInit(paths.roots[rootName], remoteEnvironment, [
        '-reconfigure',
        '-backend-config=backend.backend.hcl',
      ])
    }
    console.log(`[infra] ${provider}: remote Terraform state is ready.`)
    return
  }

  if (existsSync(bootstrapAccessPath)) rmSync(bootstrapAccessPath)

  const remoteEnvironment = backendEnvironment(
    readStateEnvironment(paths.stateEnvironment),
    terraformEnvironment,
  )
  const prepared = prepareBootstrapBackend({
    provider,
    paths,
    stateMode,
    dryRun: options.dryRun,
    remoteEnvironment,
  })
  if (prepared.migrationPending) {
    console.log(
      '[infra] local bootstrap state still needs migration; rerun without --dry-run.',
    )
    return
  }
  terraformPlan({
    root: paths.bootstrapRoot,
    env: remoteEnvironment,
    apply: !options.dryRun,
    allowedDestroyAddresses: options.allowedDestroyAddresses,
    label: `${provider}-bootstrap`,
  })
  if (!options.dryRun) {
    writeBackendArtifacts(
      provider,
      terraformOutputs(paths.bootstrapRoot, remoteEnvironment),
      paths,
    )
  }
  const currentRemoteEnvironment = options.dryRun
    ? remoteEnvironment
    : backendEnvironment(
        readStateEnvironment(paths.stateEnvironment),
        terraformEnvironment,
      )
  for (const rootName of providerRootNames[provider]) {
    terraformInit(paths.roots[rootName], currentRemoteEnvironment, [
      '-reconfigure',
      '-backend-config=backend.backend.hcl',
    ])
  }
}

function productionContext(provider) {
  const paths = providerPaths(provider)
  const tfvars = readTfvars(paths.productionRoot)
  assertProviderIdentity(provider, tfvars)
  const env = backendEnvironment(
    readStateEnvironment(paths.stateEnvironment),
    terraformEnvironment,
  )
  terraformInit(paths.productionRoot, env, [
    '-reconfigure',
    '-backend-config=backend.backend.hcl',
  ])
  for (const obsoleteName of [
    'release.auto.tfvars.json',
    'release-seed.auto.tfvars.json',
  ]) {
    const obsoletePath = resolve(paths.productionRoot, obsoleteName)
    if (existsSync(obsoletePath)) rmSync(obsoletePath)
  }
  return {
    paths,
    tfvars,
    env,
    outputs: terraformOutputs(paths.productionRoot, env),
  }
}

function initializeManagedRoot(context, rootName) {
  const root = context.paths.roots[rootName]
  if (!root)
    throw new Error(`${context.provider ?? 'provider'} has no ${rootName} root`)
  terraformInit(root, context.env, [
    '-reconfigure',
    '-backend-config=backend.backend.hcl',
  ])
  return root
}

function readManagedRootOutputs(context, rootName) {
  const root = initializeManagedRoot(context, rootName)
  return terraformOutputs(root, context.env)
}

function yandexDesiredDatabaseMetadata(tfvars, environment = process.env) {
  const slots = ['blue', 'green']
  const fingerprints = {}
  const versions = {}

  for (const slot of slots) {
    const passwordName = `TF_VAR_database_${slot}_password`
    const password = environment[passwordName]
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error(
        `${passwordName} is required to protect Yandex database credential rotation`,
      )
    }
    fingerprints[slot] = createHash('sha256').update(password).digest('hex')
    versions[slot] = tfvars[`database_${slot}_password_version`]
  }

  const jwtSecret = environment.TF_VAR_jwt_secret
  if (typeof jwtSecret !== 'string' || jwtSecret.length === 0) {
    throw new Error(
      'TF_VAR_jwt_secret is required to protect the live Yandex Lockbox version',
    )
  }
  fingerprints.jwt = createHash('sha256').update(jwtSecret).digest('hex')

  return {
    activeSlot: tfvars.database_active_slot,
    fingerprints,
    versions,
  }
}

function yandexDeployedContainerNames(tfvars) {
  const raw = runCommand(
    'yc',
    [
      'serverless',
      'container',
      'list',
      '--folder-id',
      String(tfvars.folder_id),
      '--format',
      'json',
    ],
    { capture: true, sensitiveOutput: true, log: false },
  )
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      'Could not verify Yandex runtime state because yc returned invalid container JSON',
    )
  }
  const containers = Array.isArray(parsed) ? parsed : parsed?.containers
  if (!Array.isArray(containers)) {
    throw new Error(
      'Could not verify Yandex runtime state because yc returned no container list',
    )
  }
  return containers
    .map((container) => container?.name)
    .filter((name) => typeof name === 'string')
}

function assertSafeYandexDatabaseRotation(context) {
  if (context.provider !== 'yandex') return null
  const runtimeOutputs = readManagedRootOutputs(context, 'runtime')
  const liveSlot = runtimeOutputs.database_credential_slot
  if (!liveSlot) {
    const foundationMetadata = context.outputs.database_credential_metadata
    const problems = yandexRuntimeStateProblems({
      foundationMetadata,
      deployedContainerNames: foundationMetadata
        ? yandexDeployedContainerNames(context.tfvars)
        : [],
      projectSlug: context.tfvars.project_slug,
    })
    if (problems.length > 0) {
      throw new Error(
        `Unsafe Yandex database rotation:\n- ${problems.join('\n- ')}`,
      )
    }
    return null
  }

  const problems = yandexDatabaseRotationProblems({
    current: context.outputs.database_credential_metadata,
    liveSlot,
    desired: yandexDesiredDatabaseMetadata(context.tfvars),
  })
  if (problems.length > 0) {
    throw new Error(`Unsafe Yandex database rotation:\n- ${problems.join('\n- ')}`)
  }
  return liveSlot
}

function writeManagedRootInputs(context, rootName, releaseInputs) {
  const foundationInputs = context.outputs[`${rootName}_inputs`]
  if (!foundationInputs || typeof foundationInputs !== 'object') {
    throw new Error(
      `${context.provider} foundation has no ${rootName}_inputs; run bun run infra:apply -- ${context.provider}`,
    )
  }
  const root = context.paths.roots[rootName]
  writeJsonFile(resolve(root, 'foundation.auto.tfvars.json'), foundationInputs)
  writeJsonFile(resolve(root, 'release.auto.tfvars.json'), releaseInputs)
  initializeManagedRoot(context, rootName)
  return root
}

function syncDigitalOceanFirewallInput(context, apiAppId) {
  if (context.provider !== 'digitalocean') return
  writeJsonFile(
    resolve(context.paths.productionRoot, 'runtime-link.auto.tfvars.json'),
    { trusted_api_app_id: apiAppId ?? null },
  )
}

function hasFoundationOutputs(provider, outputs) {
  if (provider === 'digitalocean') {
    return Boolean(outputs.runtime_inputs && outputs.static_inputs)
  }
  return Boolean(outputs.migration_inputs && outputs.runtime_inputs)
}

function contextWithProvider(provider) {
  const context = productionContext(provider)
  context.provider = provider
  if (provider === 'yandex') {
    const bootstrapAccessPath = resolve(
      context.paths.productionRoot,
      'storage-bootstrap.auto.tfvars.json',
    )
    if (existsSync(bootstrapAccessPath)) rmSync(bootstrapAccessPath)
  }
  if (provider === 'digitalocean') {
    const runtimeOutputs = readManagedRootOutputs(context, 'runtime')
    syncDigitalOceanFirewallInput(context, runtimeOutputs.api_app_id)
  }
  context.outputs = terraformOutputs(context.paths.productionRoot, context.env)
  return context
}

function planExistingReleaseRoots(context, options) {
  if (!hasFoundationOutputs(context.provider, context.outputs)) return

  if (context.provider === 'digitalocean') {
    const runtimeOutputs = readManagedRootOutputs(context, 'runtime')
    if (runtimeOutputs.runtime_image_digest) {
      const root = writeManagedRootInputs(context, 'runtime', {
        runtime_image_digest: runtimeOutputs.runtime_image_digest,
        admin_seed_email: null,
        admin_seed_password: null,
      })
      terraformPlan({
        root,
        env: context.env,
        apply: false,
        allowedDestroyAddresses: options.allowedDestroyAddresses,
        label: 'digitalocean-runtime',
      })
    }

    const staticOutputs = readManagedRootOutputs(context, 'static')
    if (staticOutputs.release_revision && staticOutputs.source_branch) {
      const root = writeManagedRootInputs(context, 'static', {
        release_revision: staticOutputs.release_revision,
        source_branch: staticOutputs.source_branch,
      })
      terraformPlan({
        root,
        env: context.env,
        apply: false,
        allowedDestroyAddresses: options.allowedDestroyAddresses,
        label: 'digitalocean-static',
      })
    }
    return
  }

  const migrationOutputs = readManagedRootOutputs(context, 'migration')
  if (migrationOutputs.migration_image_digest) {
    const root = writeManagedRootInputs(context, 'migration', {
      migration_image_digest: migrationOutputs.migration_image_digest,
      admin_seed_email: null,
      admin_seed_password: null,
    })
    terraformPlan({
      root,
      env: context.env,
      apply: false,
      allowedDestroyAddresses: [
        ...options.allowedDestroyAddresses,
        ...safeYandexMigrationSeedDestroyAddresses(),
      ],
      label: 'yandex-migration',
    })
  }

  const runtimeOutputs = readManagedRootOutputs(context, 'runtime')
  if (runtimeOutputs.runtime_image_digest) {
    const root = writeManagedRootInputs(context, 'runtime', {
      runtime_image_digest: runtimeOutputs.runtime_image_digest,
    })
    terraformPlan({
      root,
      env: context.env,
      apply: false,
      allowedDestroyAddresses: options.allowedDestroyAddresses,
      label: 'yandex-runtime',
    })
  }
}

async function planProduction(provider, options) {
  const context = contextWithProvider(provider)
  const liveSlot = assertSafeYandexDatabaseRotation(context)
  const safeSecretVersionDestroyAddresses =
    provider === 'yandex'
      ? safeYandexSecretVersionDestroyAddresses(liveSlot)
      : []
  const protectedSecretVersionDestroyAddresses =
    provider === 'yandex'
      ? protectedYandexSecretVersionDestroyAddresses(liveSlot)
      : []
  const safeFoundationCleanupAddresses =
    provider === 'yandex' ? safeYandexFoundationDestroyAddresses() : []
  const bootstrapAccessPath = resolve(
    context.paths.productionRoot,
    'storage-bootstrap.auto.tfvars.json',
  )
  const needsStorageBootstrap =
    provider === 'yandex' && !context.outputs.storage_manager_ready
  if (needsStorageBootstrap) {
    writeJsonFile(bootstrapAccessPath, { storage_bootstrap_access: true })
  } else if (existsSync(bootstrapAccessPath)) {
    rmSync(bootstrapAccessPath)
  }
  try {
    terraformPlan({
      root: context.paths.productionRoot,
      env: context.env,
      apply: false,
      allowedDestroyAddresses: [
        ...options.allowedDestroyAddresses,
        ...safeSecretVersionDestroyAddresses,
        ...safeFoundationCleanupAddresses,
      ],
      protectedDestroyAddresses: protectedSecretVersionDestroyAddresses,
      label: `${provider}-foundation`,
    })
  } finally {
    if (needsStorageBootstrap && existsSync(bootstrapAccessPath)) {
      rmSync(bootstrapAccessPath)
    }
  }
  planExistingReleaseRoots(context, options)
}

async function applyFoundation(provider, options) {
  const context = contextWithProvider(provider)
  const liveSlot = assertSafeYandexDatabaseRotation(context)
  const safeSecretVersionDestroyAddresses =
    provider === 'yandex'
      ? safeYandexSecretVersionDestroyAddresses(liveSlot)
      : []
  const protectedSecretVersionDestroyAddresses =
    provider === 'yandex'
      ? protectedYandexSecretVersionDestroyAddresses(liveSlot)
      : []
  const safeFoundationCleanupAddresses =
    provider === 'yandex' ? safeYandexFoundationDestroyAddresses() : []
  const bootstrapAccessPath = resolve(
    context.paths.productionRoot,
    'storage-bootstrap.auto.tfvars.json',
  )
  const firstYandexBucketApply =
    provider === 'yandex' && !context.outputs.storage_manager_ready

  if (firstYandexBucketApply) {
    writeJsonFile(bootstrapAccessPath, { storage_bootstrap_access: true })
  } else if (existsSync(bootstrapAccessPath)) {
    rmSync(bootstrapAccessPath)
  }

  try {
    await assertProductionMutationLease(options)
    terraformPlan({
      root: context.paths.productionRoot,
      env: context.env,
      apply: !options.dryRun,
      allowedDestroyAddresses: [
        ...options.allowedDestroyAddresses,
        ...safeSecretVersionDestroyAddresses,
        ...safeFoundationCleanupAddresses,
      ],
      protectedDestroyAddresses: protectedSecretVersionDestroyAddresses,
      label: `${provider}-foundation`,
    })
    await assertProductionMutationLease(options)
    if (options.dryRun || !firstYandexBucketApply) return

    rmSync(bootstrapAccessPath)
    await assertProductionMutationLease(options)
    terraformPlan({
      root: context.paths.productionRoot,
      env: context.env,
      apply: true,
      allowedDestroyAddresses: [
        ...options.allowedDestroyAddresses,
        ...safeSecretVersionDestroyAddresses,
        ...safeFoundationCleanupAddresses,
      ],
      protectedDestroyAddresses: protectedSecretVersionDestroyAddresses,
      label: 'yandex-foundation-tighten-storage-access',
    })
    await assertProductionMutationLease(options)
  } finally {
    if (existsSync(bootstrapAccessPath)) rmSync(bootstrapAccessPath)
  }
}

function showOutputs(provider) {
  const context = contextWithProvider(provider)
  const combined = { ...context.outputs }
  for (const rootName of providerRootNames[provider].filter(
    (name) => name !== 'foundation',
  )) {
    Object.assign(combined, readManagedRootOutputs(context, rootName))
  }
  console.log(JSON.stringify(safeTerraformOutputs(provider, combined), null, 2))
}

export function importReleaseInputs(provider, rootName, options) {
  const digest = options.runtimeImageDigest
  if (provider === 'digitalocean' && rootName === 'runtime') {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) {
      throw new Error(
        'runtime import requires --runtime-image-digest=sha256:...',
      )
    }
    return {
      runtime_image_digest: digest,
      admin_seed_email: null,
      admin_seed_password: null,
    }
  }
  if (provider === 'digitalocean' && rootName === 'static') {
    if (!/^[0-9a-f]{40}$/.test(options.releaseRevision ?? '')) {
      throw new Error('static import requires --release-revision=<40-char-sha>')
    }
    if (!/^infra-release\/[0-9a-f]{40}$/.test(options.sourceBranch ?? '')) {
      throw new Error(
        'static import requires --source-branch=infra-release/<40-char-sha>',
      )
    }
    if (options.sourceBranch !== `infra-release/${options.releaseRevision}`) {
      throw new Error(
        'static import release revision and source branch must identify the same commit',
      )
    }
    return {
      release_revision: options.releaseRevision,
      source_branch: options.sourceBranch,
    }
  }
  if (provider === 'yandex' && rootName === 'migration') {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) {
      throw new Error(
        'migration import requires --runtime-image-digest=sha256:...',
      )
    }
    return {
      migration_image_digest: digest,
      admin_seed_email: null,
      admin_seed_password: null,
    }
  }
  if (provider === 'yandex' && rootName === 'runtime') {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) {
      throw new Error(
        'runtime import requires --runtime-image-digest=sha256:...',
      )
    }
    return { runtime_image_digest: digest }
  }
  return {}
}

export function nonImportableResourceProblem(provider, resourceAddress) {
  const resourceType = resourceAddress?.split('.', 1)[0]
  const unsupportedTypes = {
    digitalocean: 'digitalocean_spaces_key',
    yandex: 'yandex_iam_service_account_static_access_key',
  }
  if (resourceType !== unsupportedTypes[provider]) return null

  return `${resourceType} does not support import in the pinned provider and its secret cannot be recovered. Import the surrounding bucket/service account, create a new Terraform-owned key, switch and verify every consumer, then revoke the legacy key. See docs/DEPLOYMENT.md#existing-manually-created-infrastructure.`
}

async function importResource(
  provider,
  rootName,
  resourceAddress,
  resourceId,
  options,
) {
  const allowedRoots = new Set(['bootstrap', ...providerRootNames[provider]])
  if (!allowedRoots.has(rootName)) {
    throw new Error(
      `${provider} import root must be one of: ${[...allowedRoots].join(', ')}`,
    )
  }
  if (!resourceAddress || /\s/.test(resourceAddress)) {
    throw new Error(
      'Terraform import requires one exact, whitespace-free resource address',
    )
  }
  if (!resourceId || /[\r\n]/.test(resourceId)) {
    throw new Error('Terraform import requires one provider resource ID')
  }
  const importProblem = nonImportableResourceProblem(provider, resourceAddress)
  if (importProblem) throw new Error(importProblem)

  if (rootName === 'bootstrap') {
    const paths = providerPaths(provider)
    const tfvars = readTfvars(paths.bootstrapRoot)
    assertProviderIdentity(provider, tfvars)
    const hasRemoteState = existsSync(paths.stateEnvironment)
    let localDataDirectory = null
    if (!hasRemoteState) {
      const scratchParent = resolve(repoRoot, '.scratch')
      mkdirSync(scratchParent, { recursive: true })
      localDataDirectory = mkdtempSync(
        resolve(scratchParent, 'terraform-bootstrap-import-'),
      )
    }
    const env = hasRemoteState
      ? backendEnvironment(
          readStateEnvironment(paths.stateEnvironment),
          terraformEnvironment,
        )
      : {
          ...terraformEnvironment,
          TF_DATA_DIR: localDataDirectory,
        }
    try {
      terraformInit(
        paths.bootstrapRoot,
        env,
        hasRemoteState
          ? ['-reconfigure', '-backend-config=backend.backend.hcl']
          : ['-backend=false'],
      )
      runCommand(
        'terraform',
        ['import', '-input=false', resourceAddress, resourceId],
        { cwd: paths.bootstrapRoot, env },
      )
      terraformPlan({
        root: paths.bootstrapRoot,
        env,
        apply: false,
        allowedDestroyAddresses: [],
        label: `${provider}-bootstrap-import-check`,
      })
    } finally {
      if (localDataDirectory) {
        rmSync(localDataDirectory, { recursive: true, force: true })
      }
    }
    return
  }

  const context = contextWithProvider(provider)
  let root = context.paths.roots[rootName]
  if (rootName !== 'foundation') {
    root = writeManagedRootInputs(
      context,
      rootName,
      importReleaseInputs(provider, rootName, options),
    )
  }

  await assertProductionMutationLease(options)
  runCommand(
    'terraform',
    ['import', '-input=false', resourceAddress, resourceId],
    {
      cwd: root,
      env: { ...terraformEnvironment, ...context.env },
    },
  )
  await assertProductionMutationLease(options)
  terraformPlan({
    root,
    env: context.env,
    apply: false,
    allowedDestroyAddresses: [],
    label: `${provider}-${rootName}-import-check`,
  })
  console.log(
    `[infra] ${rootName} import completed and checked with a saved plan.`,
  )
}

function assertCleanReleaseSource(releaseSource, provider, expectedCommit = null) {
  const currentBranch = runCommand('git', ['branch', '--show-current'], {
    capture: true,
    log: false,
  }).trim()
  const upstreamRef = runCommand(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { capture: true, log: false, okStatuses: [0, 128] },
  ).trim()
  const remoteName = upstreamRef.includes('/')
    ? upstreamRef.slice(0, upstreamRef.indexOf('/'))
    : ''
  let upstreamGithubRepo = null

  if (remoteName) {
    const remoteUrl = runCommand('git', ['remote', 'get-url', remoteName], {
      capture: true,
      log: false,
      okStatuses: [0, 2],
    }).trim()
    upstreamGithubRepo = githubRepositoryFromRemoteUrl(remoteUrl)
    // Refresh the exact remote-tracking ref before comparing commits. A stale local ref could
    // otherwise approve a checkout that is already behind the source App Platform will build.
    runCommand('git', ['fetch', '--quiet', '--no-tags', remoteName])
  }

  const headCommit = runCommand('git', ['rev-parse', 'HEAD'], {
    capture: true,
    log: false,
  }).trim()
  const upstreamCommit = upstreamRef
    ? runCommand('git', ['rev-parse', upstreamRef], {
        capture: true,
        log: false,
        okStatuses: [0, 128],
      }).trim()
    : ''
  const dirtyLines = runCommand('git', ['status', '--short'], {
    capture: true,
    log: false,
  })
    .trim()
    .split('\n')
    .filter(Boolean)
  const problems = releaseGitProblems({
    dirtyLines,
    currentBranch,
    configuredBranch: releaseSource?.git_branch,
    upstreamRef,
    headCommit,
    upstreamCommit,
    configuredGithubRepo:
      provider === 'digitalocean' ? releaseSource?.github_repo : null,
    upstreamGithubRepo,
    githubRepositoryRequired: provider === 'digitalocean',
    expectedCommit,
  })
  if (problems.length > 0)
    throw new Error(
      `Release source is not deployable:\n- ${problems.join('\n- ')}`,
    )
  return { commit: headCommit, remoteName, upstreamRef }
}

export function immutableReleaseBranch(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
    throw new Error(
      'An immutable release branch requires a 40-character Git commit',
    )
  }
  return `infra-release/${commit}`
}

async function ensureDigitalOceanReleaseBranch(source, assertLeaseHeld) {
  const branch = immutableReleaseBranch(source.commit)
  const ref = `refs/heads/${branch}`
  const current = runCommand(
    'git',
    ['ls-remote', '--heads', source.remoteName, ref],
    { capture: true, log: false },
  ).trim()
  if (current) {
    const remoteCommit = current.split(/\s+/)[0]
    if (remoteCommit !== source.commit) {
      throw new Error(
        `${ref} already exists at ${remoteCommit}; immutable release refs are never overwritten`,
      )
    }
    return branch
  }

  await assertLeaseHeld()
  runCommand('git', ['push', source.remoteName, `${source.commit}:${ref}`])
  await assertLeaseHeld()
  const verified = runCommand(
    'git',
    ['ls-remote', '--heads', source.remoteName, ref],
    { capture: true, log: false },
  ).trim()
  if (verified.split(/\s+/)[0] !== source.commit) {
    throw new Error(`Remote did not confirm immutable release branch ${branch}`)
  }
  return branch
}

function repositoryForImage(provider, outputs) {
  if (!outputs.image_repository)
    throw new Error(`Terraform did not return the ${provider} image repository`)
  return outputs.image_repository
}

async function buildAndPushImage(
  provider,
  repository,
  commit,
  assertLeaseHeld,
) {
  if (provider === 'digitalocean') {
    runDigitalOceanCli(['registry', 'login', '--expiry-seconds', '1200'])
  } else {
    runCommand('yc', ['container', 'registry', 'configure-docker'])
  }
  await assertLeaseHeld()

  const tag = `${repository}:${commit}`
  const archive = gitArchive(commit)
  runCommand(
    'docker',
    [
      'build',
      '--platform',
      'linux/amd64',
      '--file',
      'backend/Dockerfile',
      '--tag',
      tag,
      '-',
    ],
    {
      cwd: repoRoot,
      env: sanitizedBuildEnvironment(),
      input: archive,
    },
  )
  await assertLeaseHeld()
  runCommand('docker', ['push', tag], { env: sanitizedBuildEnvironment() })
  await assertLeaseHeld()

  const inspected = runCommand(
    'docker',
    ['image', 'inspect', '--format', '{{json .RepoDigests}}', tag],
    { capture: true, env: sanitizedBuildEnvironment() },
  ).trim()
  return digestFromRepoDigests(JSON.parse(inspected), repository)
}

function buildYandexStaticArtifacts(commit, outputs) {
  const scratchParent = resolve(repoRoot, '.scratch')
  mkdirSync(scratchParent, { recursive: true })
  const artifactRoot = mkdtempSync(resolve(scratchParent, 'infra-static-'))
  try {
    const archive = gitArchive(commit)
    runCommand(
      'docker',
      [
        'build',
        '--file',
        'infra/yandex/static.Dockerfile',
        '--target',
        'export',
        '--output',
        `type=local,dest=${artifactRoot}`,
        '--build-arg',
        `VITE_API_URL=${outputs.api_url}`,
        '--build-arg',
        `PUBLIC_WEBSITE_URL=${outputs.website_url}`,
        '--build-arg',
        `PUBLIC_WEBAPP_URL=${outputs.webapp_url}`,
        '-',
      ],
      { cwd: repoRoot, env: sanitizedBuildEnvironment(), input: archive },
    )
    writeYandexStaticReleaseMarkers(artifactRoot, commit)
    return artifactRoot
  } catch (error) {
    rmSync(artifactRoot, { recursive: true, force: true })
    throw error
  }
}

export function seedVariables(source = process.env) {
  const email = source.ADMIN_SEED_EMAIL?.trim()
  const password = source.ADMIN_SEED_PASSWORD
  if (Boolean(email) !== Boolean(password)) {
    throw new Error(
      'ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be supplied together',
    )
  }
  return email && password
    ? { admin_seed_email: email, admin_seed_password: password }
    : null
}

async function invokeYandexMigration(url) {
  if (!url)
    throw new Error(
      'Terraform did not return the Yandex migration container URL',
    )
  const token = runCommand('yc', ['iam', 'create-token'], {
    capture: true,
    sensitiveOutput: true,
    log: false,
  }).trim()
  if (!token) throw new Error('yc returned an empty IAM token')

  console.log(
    '[infra] invoking the migration task and waiting for its exit code',
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(16 * 60 * 1_000),
  })
  const exitCode = response.headers.get('x-task-exit-code')
  await response.body?.cancel()
  if (!response.ok || exitCode !== '0') {
    throw new Error(
      `Yandex migration task failed (HTTP ${response.status}, X-Task-Exit-Code ${exitCode ?? 'missing'})`,
    )
  }
}

async function publishYandexStatic(
  outputs,
  env,
  artifactRoot,
  assertLeaseHeld,
) {
  const accessKey = outputs.static_publisher_access_key_id
  const secretKey = outputs.static_publisher_secret_access_key
  if (!accessKey || !secretKey)
    throw new Error('Terraform did not return static publisher credentials')

  const uploadEnvironment = {
    ...s3CredentialEnvironment({ accessKey, secretKey }, env),
    AWS_DEFAULT_REGION: 'ru-central1',
    AWS_REGION: 'ru-central1',
  }
  const surfaces = [
    {
      distDirectory: resolve(artifactRoot, 'webapp'),
      bucket: outputs.webapp_bucket,
      immutableDirectory: 'assets',
    },
    {
      distDirectory: resolve(artifactRoot, 'website'),
      bucket: outputs.website_bucket,
      immutableDirectory: '_astro',
    },
  ]
  for (const surface of surfaces) {
    for (const step of staticUploadSteps(surface)) {
      await assertLeaseHeld()
      runCommand(step.command, step.args, { env: uploadEnvironment })
    }
  }
}

async function verifyUrl(name, url) {
  if (!url) throw new Error(`Terraform did not return ${name} URL`)
  let lastStatus = 'no response'
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      })
      lastStatus = `HTTP ${response.status}`
      await response.body?.cancel()
      if (response.ok) return
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error)
    }
    if (attempt < 12) await Bun.sleep(5_000)
  }
  throw new Error(`${name} verification failed at ${url}: ${lastStatus}`)
}

export async function verifyYandexStaticCommit(
  outputs,
  commit,
  { fetchImpl = fetch, sleepImpl = Bun.sleep } = {},
) {
  for (const [name, url] of [
    ['web app', outputs.webapp_url],
    ['website', outputs.website_url],
  ]) {
    if (!url) throw new Error(`Terraform did not return ${name} URL`)
    const markerUrl = new URL('/.well-known/release-revision', url)
    markerUrl.searchParams.set('revision', commit)
    let lastResult = 'no response'

    for (let attempt = 1; attempt <= 12; attempt += 1) {
      try {
        const response = await fetchImpl(markerUrl, {
          cache: 'no-store',
          headers: { 'cache-control': 'no-cache' },
          signal: AbortSignal.timeout(10_000),
        })
        if (response.ok) {
          const actualCommit = (await response.text()).trim()
          if (actualCommit === commit) {
            lastResult = null
            break
          }
          lastResult = `published ${actualCommit || 'an empty marker'}, expected ${commit}`
        } else {
          lastResult = `HTTP ${response.status}`
          await response.body?.cancel()
        }
      } catch (error) {
        lastResult = error instanceof Error ? error.message : String(error)
      }
      if (attempt < 12) await sleepImpl(5_000)
    }

    if (lastResult) {
      throw new Error(
        `${name} release verification failed at ${markerUrl}: ${lastResult}`,
      )
    }
  }
}

export function activeDeploymentCommitProblems(
  response,
  expectedCommit,
  expectedComponent,
) {
  const deployments = Array.isArray(response)
    ? response
    : (response?.deployments ?? [])
  const active = deployments.find(
    (deployment) => deployment?.phase === 'ACTIVE',
  )
  if (!active) return ['no ACTIVE deployment was returned']
  const components = active.static_sites ?? active.staticSites ?? []
  const component = components.find((item) => item?.name === expectedComponent)
  if (!component) {
    return [`ACTIVE deployment has no ${expectedComponent} static component`]
  }
  if (component.source_commit_hash !== expectedCommit) {
    return [
      `${expectedComponent} deployed ${component.source_commit_hash ?? 'no source commit'}, expected ${expectedCommit}`,
    ]
  }
  return []
}

async function verifyDigitalOceanStaticCommit(outputs, commit) {
  for (const [name, appId] of [
    ['webapp', outputs.webapp_app_id],
    ['website', outputs.website_app_id],
  ]) {
    if (!appId) throw new Error(`Terraform did not return ${name} App ID`)
    let problems = ['deployment has not been checked']
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const raw = runDigitalOceanCli(
        ['apps', 'list-deployments', appId, '--output', 'json'],
        { capture: true, log: false },
      )
      problems = activeDeploymentCommitProblems(JSON.parse(raw), commit, name)
      if (problems.length === 0) break
      if (attempt < 12) await Bun.sleep(5_000)
    }
    if (problems.length > 0) {
      throw new Error(
        `${name} source verification failed: ${problems.join('; ')}`,
      )
    }
  }
}

async function verifyDeployment(outputs) {
  await verifyUrl(
    'API readiness',
    `${String(outputs.api_url).replace(/\/$/, '')}/health/ready`,
  )
  await verifyUrl('web app', outputs.webapp_url)
  await verifyUrl('website', outputs.website_url)
}

export async function executePromotionPipeline(
  provider,
  operations,
  assertLeaseHeld = () => {},
) {
  const runPhase = async (operation, ...args) => {
    await assertLeaseHeld()
    const result = await operation(...args)
    await assertLeaseHeld()
    return result
  }
  if (provider === 'digitalocean') {
    const runtime = await runPhase(operations.deployRuntime)
    await runPhase(operations.tightenFoundation, runtime)
    const staticDeployment = await runPhase(operations.deployStatic, runtime)
    await runPhase(operations.verify, { runtime, staticDeployment })
    return { runtime, staticDeployment }
  }
  if (provider === 'yandex') {
    const migration = await runPhase(operations.deployMigration)
    await runPhase(operations.invokeMigration, migration)
    await runPhase(operations.removeMigrationSeed, migration)
    const runtime = await runPhase(operations.deployRuntime, migration)
    const staticDeployment = await runPhase(operations.publishStatic, runtime)
    await runPhase(operations.verify, { migration, runtime, staticDeployment })
    return { migration, runtime, staticDeployment }
  }
  throw new Error(`Unsupported provider: ${provider}`)
}

async function release(provider, options) {
  const context = contextWithProvider(provider)
  const source = options.dryRun
    ? null
    : assertCleanReleaseSource(context.outputs.release_source, provider)
  const seed = seedVariables()
  const assertLeaseHeld = () => assertProductionMutationLease(options)

  terraformPlan({
    root: context.paths.productionRoot,
    env: context.env,
    apply: false,
    allowedDestroyAddresses: options.allowedDestroyAddresses,
    label: `${provider}-foundation`,
    requireNoChanges: true,
  })
  if (!hasFoundationOutputs(provider, context.outputs)) {
    throw new Error(
      `Foundation is not provisioned; run bun run infra:apply -- ${provider}`,
    )
  }
  if (options.dryRun) {
    planExistingReleaseRoots(context, options)
    console.log(
      '[infra] dry run verified foundation and existing release states; it stops before image build and promotion.',
    )
    return
  }

  assertCleanReleaseSource(context.outputs.release_source, provider, source.commit)
  const commit = source.commit
  const repository = repositoryForImage(provider, context.outputs)
  await assertProductionMutationLease(options)
  const digest = await buildAndPushImage(
    provider,
    repository,
    commit,
    assertLeaseHeld,
  )
  await assertProductionMutationLease(options)
  assertCleanReleaseSource(context.outputs.release_source, provider, commit)

  if (provider === 'digitalocean') {
    await assertProductionMutationLease(options)
    const sourceBranch = await ensureDigitalOceanReleaseBranch(
      source,
      assertLeaseHeld,
    )
    await assertProductionMutationLease(options)
    return executePromotionPipeline(provider, {
      async deployRuntime() {
        const runtimeRoot = writeManagedRootInputs(context, 'runtime', {
          runtime_image_digest: digest,
          admin_seed_email: seed?.admin_seed_email ?? null,
          admin_seed_password: seed?.admin_seed_password ?? null,
        })
        terraformPlan({
          root: runtimeRoot,
          env: context.env,
          apply: true,
          allowedDestroyAddresses: options.allowedDestroyAddresses,
          label: 'digitalocean-runtime-migration-gated',
        })
        await assertProductionMutationLease(options)

        if (seed) {
          writeManagedRootInputs(context, 'runtime', {
            runtime_image_digest: digest,
            admin_seed_email: null,
            admin_seed_password: null,
          })
          terraformPlan({
            root: runtimeRoot,
            env: context.env,
            apply: true,
            allowedDestroyAddresses: options.allowedDestroyAddresses,
            label: 'digitalocean-remove-bootstrap-secret',
          })
          await assertProductionMutationLease(options)
        }
        return terraformOutputs(runtimeRoot, context.env)
      },
      async tightenFoundation(runtimeOutputs) {
        syncDigitalOceanFirewallInput(context, runtimeOutputs.api_app_id)
        terraformPlan({
          root: context.paths.productionRoot,
          env: context.env,
          apply: true,
          allowedDestroyAddresses: options.allowedDestroyAddresses,
          label: 'digitalocean-tighten-database-firewall',
        })
      },
      async deployStatic() {
        assertCleanReleaseSource(context.outputs.release_source, provider, commit)
        const staticRoot = writeManagedRootInputs(context, 'static', {
          release_revision: commit,
          source_branch: sourceBranch,
        })
        terraformPlan({
          root: staticRoot,
          env: context.env,
          apply: true,
          allowedDestroyAddresses: options.allowedDestroyAddresses,
          label: 'digitalocean-static-after-migration',
        })
        await assertProductionMutationLease(options)
        assertCleanReleaseSource(context.outputs.release_source, provider, commit)
        await assertProductionMutationLease(options)
        await ensureDigitalOceanReleaseBranch(source, assertLeaseHeld)
        await assertProductionMutationLease(options)
        return terraformOutputs(staticRoot, context.env)
      },
      async verify({ runtime, staticDeployment }) {
        const promotedOutputs = {
          ...context.outputs,
          ...runtime,
          ...staticDeployment,
        }
        await verifyDigitalOceanStaticCommit(staticDeployment, commit)
        await verifyDeployment(promotedOutputs)
        console.log(
          `[infra] ${provider}: release ${commit} completed and verified.`,
        )
      },
    }, () => assertProductionMutationLease(options))
  }

  return executePromotionPipeline(provider, {
    async deployMigration() {
      const root = writeManagedRootInputs(context, 'migration', {
        migration_image_digest: digest,
        admin_seed_email: seed?.admin_seed_email ?? null,
        admin_seed_password: seed?.admin_seed_password ?? null,
      })
      terraformPlan({
        root,
        env: context.env,
        apply: true,
        allowedDestroyAddresses: [
          ...options.allowedDestroyAddresses,
          ...(seed ? [] : safeYandexMigrationSeedDestroyAddresses()),
        ],
        label: 'yandex-isolated-migration',
      })
      return { root, outputs: terraformOutputs(root, context.env) }
    },
    async invokeMigration(migration) {
      await invokeYandexMigration(migration.outputs.migration_container_url)
    },
    async removeMigrationSeed(migration) {
      if (!seed) return
      writeManagedRootInputs(context, 'migration', {
        migration_image_digest: digest,
        admin_seed_email: null,
        admin_seed_password: null,
      })
      terraformPlan({
        root: migration.root,
        env: context.env,
        apply: true,
        allowedDestroyAddresses: [
          ...options.allowedDestroyAddresses,
          ...safeYandexMigrationSeedDestroyAddresses(),
        ],
        label: 'yandex-remove-bootstrap-secret',
      })
    },
    async deployRuntime() {
      const root = writeManagedRootInputs(context, 'runtime', {
        runtime_image_digest: digest,
      })
      terraformPlan({
        root,
        env: context.env,
        apply: true,
        allowedDestroyAddresses: options.allowedDestroyAddresses,
        label: 'yandex-runtime-after-migration',
      })
      return terraformOutputs(root, context.env)
    },
    async publishStatic(runtimeOutputs) {
      const promotedOutputs = { ...context.outputs, ...runtimeOutputs }
      assertCleanReleaseSource(context.outputs.release_source, provider, commit)
      const artifactRoot = buildYandexStaticArtifacts(commit, promotedOutputs)
      try {
        await assertLeaseHeld()
        assertCleanReleaseSource(context.outputs.release_source, provider, commit)
        await publishYandexStatic(
          promotedOutputs,
          context.env,
          artifactRoot,
          assertLeaseHeld,
        )
      } finally {
        rmSync(artifactRoot, { recursive: true, force: true })
      }
      return promotedOutputs
    },
    async verify({ staticDeployment }) {
      assertCleanReleaseSource(context.outputs.release_source, provider, commit)
      await verifyYandexStaticCommit(staticDeployment, commit)
      await verifyDeployment(staticDeployment)
      console.log(
        `[infra] ${provider}: release ${commit} completed and verified.`,
      )
    },
  }, () => assertProductionMutationLease(options))
}

export function parseArguments(argv) {
  const args = argv.filter((argument) => argument !== '--')
  const [command, provider, ...operands] = args.filter(
    (argument) => !argument.startsWith('--'),
  )
  const allowedDestroyAddresses = args
    .filter((argument) => argument.startsWith('--allow-destroy='))
    .map((argument) => argument.slice('--allow-destroy='.length))
    .filter(Boolean)

  const commands = ['bootstrap', 'apply', 'plan', 'release', 'output', 'import']
  if (!commands.includes(command) || !supportedProviders.has(provider)) {
    throw new Error(
      'Usage: bun scripts/infra.mjs <bootstrap|apply|plan|release|output> <digitalocean|yandex> [options], or import <provider> <root> <terraform-address> <provider-resource-id>',
    )
  }
  const importFlagPrefixes = [
    '--runtime-image-digest=',
    '--release-revision=',
    '--source-branch=',
  ]
  const bootstrapFlagPrefixes = [
    '--recover-state-bucket=',
    '--recover-state-region=',
  ]
  const unknownFlags = args.filter(
    (argument) =>
      argument.startsWith('--') &&
      argument !== '--dry-run' &&
      argument !== '--new' &&
      !argument.startsWith('--allow-destroy=') &&
      !importFlagPrefixes.some((prefix) => argument.startsWith(prefix)) &&
      !bootstrapFlagPrefixes.some((prefix) => argument.startsWith(prefix)),
  )
  if (unknownFlags.length > 0)
    throw new Error(`Unknown option: ${unknownFlags.join(', ')}`)
  if (
    command === 'output' &&
    args.some((argument) => argument.startsWith('--'))
  ) {
    throw new Error(`${command} does not accept release options`)
  }
  if (
    command !== 'import' &&
    importFlagPrefixes.some((prefix) =>
      args.some((argument) => argument.startsWith(prefix)),
    )
  ) {
    throw new Error('Adoption flags are accepted only by import')
  }
  if (
    command !== 'bootstrap' &&
    (args.includes('--new') ||
      bootstrapFlagPrefixes.some((prefix) =>
        args.some((argument) => argument.startsWith(prefix)),
      ))
  ) {
    throw new Error('State creation and recovery flags are accepted only by bootstrap')
  }
  if (
    command === 'import' &&
    args.some(
      (argument) =>
        argument === '--dry-run' || argument.startsWith('--allow-destroy='),
    )
  ) {
    throw new Error('import does not accept release or destroy options')
  }
  if (command === 'import' ? operands.length !== 3 : operands.length !== 0) {
    throw new Error(
      command === 'import'
        ? 'Usage: bun scripts/infra.mjs import <digitalocean|yandex> <root> <terraform-address> <provider-resource-id>'
        : `${command} does not accept positional arguments after the provider`,
    )
  }

  const flagValue = (prefix) =>
    args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)

  const recoverStateBucket = flagValue('--recover-state-bucket=')
  const recoverStateRegion = flagValue('--recover-state-region=')
  if (Boolean(recoverStateBucket) !== Boolean(recoverStateRegion)) {
    throw new Error(
      'State recovery requires both --recover-state-bucket and --recover-state-region',
    )
  }
  if (args.includes('--new') && recoverStateBucket) {
    throw new Error('--new and --recover-state-* are mutually exclusive')
  }

  return {
    command,
    provider,
    dryRun: args.includes('--dry-run') || command === 'plan',
    allowedDestroyAddresses,
    rootName: operands[0],
    resourceAddress: operands[1],
    resourceId: operands[2],
    runtimeImageDigest: flagValue('--runtime-image-digest='),
    releaseRevision: flagValue('--release-revision='),
    sourceBranch: flagValue('--source-branch='),
    newBootstrap: args.includes('--new'),
    recoverStateBucket,
    recoverStateRegion,
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (productionMutationNeedsLease(options)) {
    return withProductionMutationLease(
      () => acquireProductionMutationLease(options.provider),
      (mutationLease) => executeCommand({ ...options, mutationLease }),
    )
  }
  return executeCommand(options)
}

async function executeCommand(options) {
  if (options.command === 'bootstrap')
    return bootstrap(options.provider, options)
  if (options.command === 'apply')
    return applyFoundation(options.provider, options)
  if (options.command === 'plan')
    return planProduction(options.provider, options)
  if (options.command === 'output') return showOutputs(options.provider)
  if (options.command === 'import') {
    return importResource(
      options.provider,
      options.rootName,
      options.resourceAddress,
      options.resourceId,
      options,
    )
  }
  return release(options.provider, options)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(
      `[infra] ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
}
