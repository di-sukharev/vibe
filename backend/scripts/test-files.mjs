import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Glob } from 'bun'

/**
 * Splits the backend test files between the three runners, by filename.
 *
 * A test that needs the database is named `*.integration.test.ts`; a test that needs a service no
 * runner starts for it - the local S3 container, or an email provider - is named
 * `*.live.test.ts`; everything else runs with nothing installed. That third category is why
 * `bun run test` stays runnable on a machine with no Docker daemon: a live test landing in the
 * unit set would fail for everyone who has not started a container, which is the fastest way to
 * teach people to ignore a red suite.
 *
 * A suite belonging to a capability that ships switched off - billing, for instance, whose tables
 * are commented out in the Prisma schema - marks itself `@parked-test` in its opening comment and
 * is skipped by every runner until that line is removed. Parking is declared in the file it
 * affects rather than in a list here.
 */
export function backendTestFiles(backendRoot) {
  const all = [...new Glob('{src,scripts}/**/*.test.{ts,mjs}').scanSync(backendRoot)].sort()

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
