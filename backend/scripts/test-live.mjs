#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { backendTestFiles } from './test-files.mjs'

/**
 * Runs the backend tests that need a real external service.
 *
 * Unlike the unit and integration runners, this one starts nothing: the service it needs is the
 * local S3 container, and `bun run test:storage:s3` at the repository root brings that up and
 * passes the `PRIVATE_STORAGE_*` settings in. Running this script directly against an
 * unconfigured environment is therefore refused rather than silently skipped, because a live
 * contract test that quietly passes without contacting anything proves nothing.
 */
const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const { live: liveTestFiles } = backendTestFiles(backendRoot)

if (liveTestFiles.length === 0) {
  console.error('No backend live tests found. That is almost certainly a glob or layout problem.')
  process.exit(1)
}

if (!process.env.PRIVATE_STORAGE_ENDPOINT) {
  console.error(
    'PRIVATE_STORAGE_ENDPOINT is not set, so there is nothing to test against. Run "bun run test:storage:s3" from the repository root instead.',
  )
  process.exit(1)
}

for (const step of [
  ['run', 'prisma:generate'],
  ['test', ...liveTestFiles],
]) {
  const result = spawnSync('bun', step, { cwd: backendRoot, stdio: 'inherit' })

  if (result.status !== 0) process.exit(result.status ?? 1)
}
