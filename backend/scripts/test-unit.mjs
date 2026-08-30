#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { backendTestFiles, selectBackendTestRun } from './test-files.mjs'

/**
 * Runs selected backend tests that do not need a database, or all of them without CLI filters.
 *
 * `bun test` with no arguments would also pick up the `*.integration.test.ts` files, which need the
 * Docker Postgres that `test-integration.mjs` starts. Both runners take their file lists from
 * `test-files.mjs`, so they stay complementary by construction.
 */
const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const { unit: discoveredUnitTestFiles } = backendTestFiles(backendRoot)

if (discoveredUnitTestFiles.length === 0) {
  console.error('No backend unit tests found. That is almost certainly a glob or layout problem.')
  process.exit(1)
}

let selectedTestRun
try {
  selectedTestRun = selectBackendTestRun(
    discoveredUnitTestFiles,
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
