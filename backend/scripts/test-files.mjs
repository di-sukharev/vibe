import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Glob } from 'bun'

const runnerPattern = '{src,scripts}/**/*.test.{ts,mjs}'
// Deliberately wider than `runnerPattern` and written separately: it is what notices when the
// pattern above is narrowed. A test asserting the same thing cannot do this job, because
// narrowing the pattern can stop the test file itself from running. The suffixes are bun's own
// test-file conventions, not just this repository's, so a file named `foo.spec.ts` by habit is
// caught rather than silently ignored.
const anyTestFilePattern = '**/*{.test,.spec,_test,_spec}.{ts,tsx,mts,cts,js,mjs,cjs,jsx}'

/**
 * Splits the backend test files between the three runners.
 *
 * The split is by filename, not by a hand-maintained list: a list rots silently, because `bun test`
 * treats a path that no longer exists as a filter matching nothing rather than as an error. A test
 * that needs the database is named `*.integration.test.ts`; a test that needs a service no runner
 * starts for it - today the local S3 container - is named `*.live.test.ts`; everything else runs
 * with nothing installed.
 *
 * The live category exists so `bun run test` stays runnable on a machine with no Docker daemon.
 * Without it a live test would land in the unit set and fail for everyone who has not started a
 * container, which is the fastest way to teach people to ignore a red suite.
 *
 * A suite belonging to a capability that ships switched off - billing, for instance, whose tables
 * are commented out in the Prisma schema - marks itself `@parked-test` in its opening comment and
 * is skipped by every runner until that line is removed. Parking is declared in the file it
 * affects rather than in a list here, for the same reason as everything else above.
 *
 * Throws if any test file in the backend matches no runner - a suite that runs nowhere and
 * fails nothing is the failure mode this whole module exists to prevent.
 */
export function backendTestFiles(backendRoot) {
  const all = [...new Glob(runnerPattern).scanSync(backendRoot)].sort()
  const unclaimed = [...new Glob(anyTestFilePattern).scanSync(backendRoot)]
    .filter((file) => !file.includes('node_modules/') && !all.includes(file))
    .sort()

  if (unclaimed.length > 0) {
    throw new Error(
      `These backend test files run in no test runner: ${unclaimed.join(', ')}. Either move them under src/ or scripts/, or widen the pattern in backend/scripts/test-files.mjs.`,
    )
  }

  const parked = all.filter((file) => isParked(join(backendRoot, file)))
  const active = all.filter((file) => !parked.includes(file))

  return {
    all,
    parked,
    unit: active.filter(
      (file) => !file.includes('.integration.test.') && !file.includes('.live.test.'),
    ),
    integration: active.filter((file) => file.includes('.integration.test.')),
    live: active.filter((file) => file.includes('.live.test.')),
  }
}

/**
 * True when the marker appears in the file's leading comment block - the lines before its first
 * statement - and nowhere else.
 *
 * A byte budget was the wrong rule: this file's own test suite mentions `@parked-test` in a test
 * title and a fixture, so reordering its tests could push the marker into range and park the one
 * suite that polices parking, silently and with a green exit code. A file that starts with an
 * import cannot park itself no matter what it contains.
 */
function isParked(absolutePath) {
  for (const line of readFileSync(absolutePath, 'utf8').split('\n')) {
    const text = line.trim()

    if (text === '') continue
    if (!text.startsWith('//') && !text.startsWith('/*') && !text.startsWith('*')) return false
    if (text.includes('@parked-test')) return true
  }

  return false
}
