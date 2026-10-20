#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { backendTestFiles, selectBackendTestRun } from './test-files.mjs'

/**
 * Runs backend integration tests that do not need a database.
 *
 * `bun test` with no arguments would also pick up the `*.integration.test.ts` files, which need the
 * Docker Postgres that `test-integration.mjs` starts. Both runners take their file lists from
 * `test-files.mjs`, so they stay complementary by construction.
 */
const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const { local: discoveredLocalTestFiles } = backendTestFiles(backendRoot)

if (discoveredLocalTestFiles.length === 0) {
  console.error('No local backend integration tests found. Check the test filenames and directories.')
  process.exit(1)
}

let selectedTestRun
try {
  selectedTestRun = selectBackendTestRun(
    discoveredLocalTestFiles,
    process.argv.slice(2),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

for (const step of [
  ['run', 'prisma:generate'],
  ['test', ...selectedTestRun.testFiles, ...selectedTestRun.bunTestArgs],
]) {
  const result = spawnSync('bun', step, { cwd: backendRoot, stdio: 'inherit' })

  if (result.status !== 0) process.exit(result.status ?? 1)
}
