#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'

import {
  browserUploadAllowedHeaders,
  browserUploadExposedHeaders,
} from '../backend/src/storage/config.ts'
import {
  assertLocalPrivateStorageEndpoint,
  composeEnv,
  composeProjectName,
  defaultPrivateStorageS3Port,
  localPrivateStorageAccessKeyId,
  localPrivateStorageBucket,
  localPrivateStorageCorsRule,
  localPrivateStorageEndpoint,
  localPrivateStorageEnv,
  localPrivateStorageSecretAccessKey,
  localPrivateStorageService,
  repositoryRoot,
} from './repo-env.mjs'

/**
 * Lifecycle for the optional local S3 container.
 *
 * Two rules shape everything here. Every docker command is scoped to this repository's compose
 * project and names the one service explicitly, so running this can never stop or delete a
 * container belonging to another project. And `stop` is `stop`, never `down`: the named volume
 * and the Postgres services have to survive, because losing an uploaded file to a routine
 * "turn it off" is exactly the surprise a template must not ship.
 */

const commands = new Set(['start', 'status', 'stop', 'env', 'dev-backend', 'test', 'e2e'])

function printUsage() {
  process.stderr.write(
    [
      'Usage: bun scripts/storage-local.mjs <command>',
      '',
      '  start        start the local S3 container, create the bucket, apply CORS',
      '  status       report whether the container is up and the bucket reachable',
      '  stop         stop the container, keeping its volume and other services',
      '  env          print the PRIVATE_STORAGE_* block for this checkout',
      '  dev-backend  start storage, then run the backend against it',
      '  test         start storage, then run the live storage contract tests',
      '  e2e          start storage, then run the web E2E suite against it',
      '',
    ].join('\n'),
  )
}

const port = defaultPrivateStorageS3Port
const endpoint = localPrivateStorageEndpoint(port)
const composeArgs = ['compose', '-p', composeProjectName]

function run(command, args, env = composeEnv()) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, env, stdio: 'inherit' })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function createS3Client() {
  return import('@aws-sdk/client-s3').then(({ S3Client }) => ({
    client: new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: localPrivateStorageAccessKeyId,
        secretAccessKey: localPrivateStorageSecretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    }),
  }))
}

async function bucketIsReachable() {
  const { HeadBucketCommand } = await import('@aws-sdk/client-s3')
  const { client } = await createS3Client()

  try {
    await client.send(new HeadBucketCommand({ Bucket: localPrivateStorageBucket }))
    return true
  } catch {
    return false
  } finally {
    client.destroy()
  }
}

/**
 * Readiness is asserted with a real signed request rather than a container health flag: what
 * matters is that the S3 API answers, the credentials work, and the bucket exists.
 */
async function waitForBucket({ attempts = 90, delayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await bucketIsReachable()) return
    if (attempt === 1) {
      process.stdout.write('Waiting for the local S3 container to become ready...\n')
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  throw new Error(
    `Local S3 storage did not become ready at ${endpoint}. Check "docker compose -p ${composeProjectName} logs ${localPrivateStorageService}".`,
  )
}

function corsOrigins({ anyOrigin = false } = {}) {
  // The E2E web server picks a port derived from this checkout's path, so an allowlist - even a
  // deliberately exported one - cannot name it. That run needs the permissive rule.
  if (anyOrigin) return ['*']

  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (configured.length > 0) return configured

  // No configured origins: allow any. The E2E web server picks a port derived from this
  // checkout's path, so an allowlist here would have to guess it. This bucket is a disposable
  // local container with fixed fake credentials, reachable only on loopback.
  return ['*']
}

async function applyBucketCors({ anyOrigin = false } = {}) {
  const { CreateBucketCommand, PutBucketCorsCommand } = await import('@aws-sdk/client-s3')
  const { client } = await createS3Client()

  try {
    try {
      await client.send(new CreateBucketCommand({ Bucket: localPrivateStorageBucket }))
    } catch (error) {
      // The container pre-creates the bucket; owning it already is the normal case.
      const name = error?.name ?? ''
      if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(name)) throw error
    }

    await client.send(
      new PutBucketCorsCommand({
        Bucket: localPrivateStorageBucket,
        CORSConfiguration: {
          CORSRules: [localPrivateStorageCorsRule(
              corsOrigins({ anyOrigin }),
              browserUploadAllowedHeaders,
              browserUploadExposedHeaders,
            )],
        },
      }),
    )
  } finally {
    client.destroy()
  }
}

function envBlock() {
  return Object.entries(localPrivateStorageEnv(port))
    .map(([name, value]) => `${name}=${value}`)
    .join('\n')
}

async function start({ quiet = false, anyOrigin = false } = {}) {
  assertLocalPrivateStorageEndpoint(endpoint)

  run('docker', [...composeArgs, 'up', '-d', localPrivateStorageService])
  await waitForBucket()
  await applyBucketCors({ anyOrigin })

  if (!quiet) {
    process.stdout.write(`Local S3 storage is ready at ${endpoint}\n\n${envBlock()}\n`)
  }
}

async function status() {
  run('docker', [...composeArgs, 'ps', localPrivateStorageService])

  if (await bucketIsReachable()) {
    process.stdout.write(`Bucket "${localPrivateStorageBucket}" is reachable at ${endpoint}\n`)
    return
  }

  process.stderr.write(
    `Bucket "${localPrivateStorageBucket}" is not reachable at ${endpoint}. Run "bun run storage:local:start".\n`,
  )
  process.exitCode = 1
}

function stop() {
  // `stop`, not `down`: `down` would also take the database with it and, with --volumes, the
  // uploaded objects. Stopping keeps everything and simply frees the port.
  run('docker', [...composeArgs, 'stop', localPrivateStorageService])
  process.stdout.write('Local S3 storage stopped. Its volume is kept.\n')
}

async function runAgainstLocalStorage(command, args, { anyOrigin = false } = {}) {
  await start({ quiet: true, anyOrigin })
  process.stdout.write(`Local S3 storage is ready at ${endpoint}\n`)

  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: composeEnv(localPrivateStorageEnv(port)),
    stdio: 'inherit',
  })

  process.exit(result.status ?? 1)
}

async function main() {
  const command = process.argv[2]

  if (!commands.has(command)) {
    printUsage()
    process.exit(1)
  }

  if (command === 'env') {
    process.stdout.write(`${envBlock()}\n`)
    return
  }
  if (command === 'start') return start()
  if (command === 'status') return status()
  if (command === 'stop') return stop()
  if (command === 'dev-backend') {
    return runAgainstLocalStorage('bun', ['run', '--cwd', 'backend', 'dev'])
  }
  if (command === 'test') {
    return runAgainstLocalStorage('bun', ['run', '--cwd', 'backend', 'test:live'])
  }
  return runAgainstLocalStorage('bun', ['run', '--cwd', 'webapp', 'e2e'], { anyOrigin: true })
}

if (import.meta.main) {
  await main()
}
