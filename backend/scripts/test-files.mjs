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
 * Splits the backend test files between the two runners.
 *
 * The split is by filename, not by a hand-maintained list: a list rots silently, because `bun test`
 * treats a path that no longer exists as a filter matching nothing rather than as an error. A test
 * that needs the database is named `*.integration.test.ts`; everything else runs without one.
 *
 * A suite belonging to a capability that ships switched off - billing, for instance, whose tables
 * are commented out in the Prisma schema - marks itself `@parked-test` in its opening comment and
 * is skipped by both runners until that line is removed. Parking is declared in the file it
 * affects rather than in a list here, for the same reason as everything else above.
 *
 * Throws if any test file in the backend matches neither runner - a suite that runs nowhere and
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
    unit: active.filter((file) => !file.includes('.integration.test.')),
    integration: active.filter((file) => file.includes('.integration.test.')),
  }
}

function isParked(absolutePath) {
  // Only the header, so the marker cannot be triggered by a string deep inside a test.
  return readFileSync(absolutePath, 'utf8').slice(0, 600).includes('@parked-test')
}
