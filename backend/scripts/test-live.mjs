#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { backendTestFiles } from './test-files.mjs'

/**
 * Runs the backend tests that need a real external service.
 *
 * Unlike the unit and integration runners, this one starts nothing: every suite below needs
 * credentials or a container the repository cannot conjure. Running against an unconfigured
 * environment is refused rather than silently skipped, because a live contract test that quietly
 * passes without contacting anything proves nothing.
 *
 * A partially configured suite is an error too, and names the missing variables. Skipping it
 * would be the same lie in a more convincing costume: the operator asked for that suite by
 * setting some of its variables.
 */
export const liveSuites = [
  {
    name: 'storage (S3)',
    match: (file) => file.includes('/s3-storage.'),
    // Keys unique to this suite. Setting any of them is what says "run this one".
    identifiedBy: ['PRIVATE_STORAGE_ENDPOINT'],
    // Shared with other suites, so their absence cannot mean "the operator wanted this suite".
    alsoRequires: [],
    how: 'run "bun run test:storage:s3" from the repository root, which brings the container up for you',
  },
  {
    name: 'email (Postbox)',
    match: (file) => file.includes('/postbox-delivery.'),
    identifiedBy: ['EMAIL_POSTBOX_ACCESS_KEY_ID', 'EMAIL_POSTBOX_SECRET_ACCESS_KEY'],
    alsoRequires: ['EMAIL_FROM', 'EMAIL_LIVE_TEST_TO'],
    how: 'see docs/EMAIL.md, "Proving it works"',
  },
  {
    name: 'email (Resend)',
    match: (file) => file.includes('/resend-delivery.'),
    identifiedBy: ['EMAIL_RESEND_API_KEY'],
    alsoRequires: ['EMAIL_FROM', 'EMAIL_LIVE_TEST_TO'],
    how: 'see docs/EMAIL.md, "Proving it works"',
  },
]

/**
 * Decides which suites to run, and why.
 *
 * The split between `identifiedBy` and `alsoRequires` is the whole point. `EMAIL_FROM` and
 * `EMAIL_LIVE_TEST_TO` are shared by both email suites, so treating them as evidence of intent
 * would make configuring one provider look like a half-configured attempt at the other - and
 * refusing to run at all unless the operator holds accounts with both. Only the provider
 * credentials say "run this suite"; the shared settings are then required, not interpreted.
 *
 * Exported so `test-live.test.mjs` can drive it without spawning anything.
 */
export function selectLiveSuites(env, suites = liveSuites) {
  const selected = []

  for (const suite of suites) {
    if (!suite.identifiedBy.some((name) => env[name])) continue

    const missing = [...suite.identifiedBy, ...suite.alsoRequires].filter((name) => !env[name])

    if (missing.length > 0) {
      return {
        selected: [],
        error: `The ${suite.name} suite is half configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. Set ${missing.length === 1 ? 'it' : 'them'} or unset the rest - ${suite.how}.`,
      }
    }

    selected.push(suite)
  }

  return { selected, error: null }
}

// Everything below runs only as a command, so a test can import the selection above.
if (import.meta.main) {
  const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

  const { live: liveTestFiles } = backendTestFiles(backendRoot)

  if (liveTestFiles.length === 0) {
    console.error('No backend live tests found. That is almost certainly a glob or layout problem.')
    process.exit(1)
  }

  const { selected: configured, error } = selectLiveSuites(process.env)

  if (error) {
    console.error(error)
    process.exit(1)
  }

  if (configured.length === 0) {
    console.error('No live suite is configured, so there is nothing to test against. Pick one:')
    for (const suite of liveSuites) {
      console.error(
        `  - ${suite.name}: needs ${[...suite.identifiedBy, ...suite.alsoRequires].join(', ')} - ${suite.how}`,
      )
    }
    process.exit(1)
  }

  const selected = liveTestFiles.filter((file) => configured.some((suite) => suite.match(file)))

  console.log(`Running live suites: ${configured.map((suite) => suite.name).join(', ')}.`)

  for (const step of [
    ['run', 'prisma:generate'],
    ['test', ...selected],
  ]) {
    const result = spawnSync('bun', step, { cwd: backendRoot, stdio: 'inherit' })

    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
