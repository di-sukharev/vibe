#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  'infra/digitalocean/bootstrap',
  'infra/digitalocean/operations',
  'infra/digitalocean/production',
  'infra/digitalocean/runtime',
  'infra/digitalocean/static',
  'infra/yandex/bootstrap',
  'infra/yandex/operations',
  'infra/yandex/production',
  'infra/yandex/migration',
  'infra/yandex/runtime',
]

const testDirectory = mkdtempSync(
  resolve(tmpdir(), 'vibecoding-terraform-test-'),
)
const pluginCacheDirectory = resolve(testDirectory, 'plugin-cache')
const spawnedProcesses = new Set()
mkdirSync(pluginCacheDirectory)

try {
  for (const [index, relativeRoot] of roots.entries()) {
    const dataDirectory = resolve(testDirectory, `root-${index}`)
    mkdirSync(dataDirectory)
    const environment = {
      ...process.env,
      CHECKPOINT_DISABLE: '1',
      TF_DATA_DIR: dataDirectory,
      TF_IN_AUTOMATION: '1',
      TF_INPUT: '0',
      TF_PLUGIN_CACHE_DIR: pluginCacheDirectory,
    }
    run(['init', '-backend=false', '-input=false'], relativeRoot, environment)
    run(['validate'], relativeRoot, environment)
    run(['test'], relativeRoot, environment)
  }
  await testProductionMutationLease()
} finally {
  for (const child of spawnedProcesses) child.kill('SIGTERM')
  rmSync(testDirectory, { recursive: true, force: true })
}

async function testProductionMutationLease() {
  const sourceRoot = resolve(repoRoot, 'infra/digitalocean/operations')
  const root = resolve(testDirectory, 'lease-root')
  const dataDirectory = resolve(testDirectory, 'lease-terraform-data')
  const statePath = resolve(testDirectory, 'operations.tfstate')
  const firstReady = resolve(testDirectory, 'lease-first-ready')
  const firstRelease = resolve(testDirectory, 'lease-first-release')
  mkdirSync(root)
  mkdirSync(dataDirectory)
  const productionConfiguration = readFileSync(
    resolve(sourceRoot, 'main.tf'),
    'utf8',
  )
  const localConfiguration = productionConfiguration.replace(
    /\n  backend "s3" \{[\s\S]*?\n  \}\n/,
    '\n',
  )
  if (localConfiguration === productionConfiguration) {
    throw new Error('operations lease test could not isolate the backend block')
  }
  writeFileSync(resolve(root, 'main.tf'), localConfiguration)
  const environment = {
    ...process.env,
    CHECKPOINT_DISABLE: '1',
    TF_DATA_DIR: dataDirectory,
    TF_IN_AUTOMATION: '1',
    TF_INPUT: '0',
  }
  run(['init', '-backend=false', '-input=false'], root, environment)

  const firstOwner = 'integration-owner-one'
  const first = spawnTerraformApply({
    root,
    environment,
    statePath,
    owner: firstOwner,
    readySignal: firstReady,
    releaseSignal: firstRelease,
    parentPid: process.pid,
  })
  await waitForReadySignal(firstReady, firstOwner, first.completion)

  writeFileSync(firstRelease, 'wrong-owner', { mode: 0o600 })
  await delay(1_200)
  if (first.child.exitCode !== null) {
    throw new Error(
      'operations lease exited after a release signal from the wrong owner',
    )
  }

  const competing = spawnTerraformApply({
    root,
    environment,
    statePath,
    owner: 'integration-owner-two',
    readySignal: resolve(testDirectory, 'lease-competing-ready'),
    releaseSignal: resolve(testDirectory, 'lease-competing-release'),
    parentPid: process.pid,
  })
  const competingResult = await competing.completion
  if (competingResult.code === 0) {
    throw new Error('a competing operations lease acquired the same state lock')
  }

  writeFileSync(firstRelease, firstOwner, { mode: 0o600 })
  assertSuccessfulLeaseResult('owner release', await first.completion)
  assertSuccessfulLeaseResult(
    'retry after owner release',
    await spawnImmediateTerraformApply({
      root,
      environment,
      statePath,
      owner: 'integration-owner-three',
    }),
  )

  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })
  spawnedProcesses.add(parent)
  parent.once('close', () => spawnedProcesses.delete(parent))
  const parentReady = resolve(testDirectory, 'lease-parent-ready')
  const parentRelease = resolve(testDirectory, 'lease-parent-release')
  const parentOwned = spawnTerraformApply({
    root,
    environment,
    statePath,
    owner: 'integration-parent-owner',
    readySignal: parentReady,
    releaseSignal: parentRelease,
    parentPid: parent.pid,
  })
  await waitForReadySignal(
    parentReady,
    'integration-parent-owner',
    parentOwned.completion,
  )
  parent.kill('SIGTERM')
  assertSuccessfulLeaseResult('parent death cleanup', await parentOwned.completion)
  assertSuccessfulLeaseResult(
    'retry after parent death',
    await spawnImmediateTerraformApply({
      root,
      environment,
      statePath,
      owner: 'integration-owner-four',
    }),
  )
  console.log(
    '[terraform-test] operations lease: contention, owner release, and parent-death cleanup passed',
  )
}

function spawnTerraformApply({
  root,
  environment,
  statePath,
  owner,
  readySignal,
  releaseSignal,
  parentPid,
}) {
  const holderCommand = [
    process.execPath,
    resolve(repoRoot, 'scripts', 'infra-lease-holder.mjs'),
  ]
    .map(shellSingleQuote)
    .join(' ')
  return spawnCaptured(
    'terraform',
    [
      'apply',
      '-auto-approve',
      '-input=false',
      '-lock-timeout=1s',
      `-state=${statePath}`,
      `-var=owner_token=${owner}`,
      `-var=holder_command=${holderCommand}`,
      `-var=ready_signal=${readySignal}`,
      `-var=release_signal=${releaseSignal}`,
      `-var=parent_pid=${parentPid}`,
    ],
    { cwd: root, env: environment },
  )
}

function spawnImmediateTerraformApply({ root, environment, statePath, owner }) {
  return spawnCaptured(
    'terraform',
    [
      'apply',
      '-auto-approve',
      '-input=false',
      '-lock-timeout=1s',
      `-state=${statePath}`,
      `-var=owner_token=${owner}`,
      '-var=holder_command=true',
      `-var=ready_signal=${resolve(testDirectory, `${owner}-ready`)}`,
      `-var=release_signal=${resolve(testDirectory, `${owner}-release`)}`,
      `-var=parent_pid=${process.pid}`,
    ],
    { cwd: root, env: environment },
  ).completion
}

function spawnCaptured(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  spawnedProcesses.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${String(chunk)}`.slice(-8_000)
  })
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-8_000)
  })
  const completion = new Promise((resolveCompletion) => {
    child.once('error', (error) => {
      spawnedProcesses.delete(child)
      resolveCompletion({ code: null, error, stderr, stdout })
    })
    child.once('close', (code, signal) => {
      spawnedProcesses.delete(child)
      resolveCompletion({ code, signal, stderr, stdout })
    })
  })
  return { child, completion }
}

async function waitForReadySignal(path, owner, completion) {
  const deadline = Date.now() + 10_000
  while (!existsSync(path)) {
    const outcome = await Promise.race([completion, delay(50)])
    if (outcome) {
      throw new Error(
        `operations lease exited before readiness: ${outcome.stderr || outcome.stdout}`,
      )
    }
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for the operations lease readiness signal')
    }
  }
  if (readFileSync(path, 'utf8') !== owner) {
    throw new Error('operations lease readiness owner did not match')
  }
}

function assertSuccessfulLeaseResult(label, result) {
  if (result.error || result.code !== 0) {
    throw new Error(
      `${label} failed: ${result.error?.message || result.stderr || result.stdout}`,
    )
  }
}

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function delay(milliseconds) {
  return new Promise((resolveDelay) =>
    setTimeout(() => resolveDelay(null), milliseconds),
  )
}

function run(args, relativeRoot, env) {
  console.log(`[terraform-test] ${relativeRoot}: terraform ${args.join(' ')}`)
  const result = spawnSync('terraform', args, {
    cwd: resolve(repoRoot, relativeRoot),
    env,
    stdio: 'inherit',
  })
  if (result.error?.code === 'ENOENT') {
    throw new Error('terraform is not installed or is not available on PATH')
  }
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${relativeRoot}: terraform ${args[0]} failed with status ${result.status ?? 1}`,
    )
  }
}
