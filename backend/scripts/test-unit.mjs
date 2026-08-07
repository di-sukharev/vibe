#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { backendTestFiles } from './test-files.mjs'

/**
 * Runs every backend test that does not need a database.
 *
 * `bun test` with no arguments would also pick up the `*.integration.test.ts` files, which need the
 * Docker Postgres that `test-integration.mjs` starts. Both runners take their file lists from
 * `test-files.mjs`, so they stay complementary by construction.
 */
const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const { unit: unitTestFiles } = backendTestFiles(backendRoot)

if (unitTestFiles.length === 0) {
  console.error('No backend unit tests found. That is almost certainly a glob or layout problem.')
  process.exit(1)
}

for (const step of [
  ['run', 'prisma:generate'],
  ['test', ...unitTestFiles],
]) {
  const result = spawnSync('bun', step, { cwd: backendRoot, stdio: 'inherit' })

  if (result.status !== 0) process.exit(result.status ?? 1)
}
