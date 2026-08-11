import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { backendTestFiles } from './test-files.mjs'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

describe('backendTestFiles', () => {
  const { all, parked, unit, integration, live } = backendTestFiles(backendRoot)

  test('every test file lands in exactly one runner, or is explicitly parked', () => {
    // Losing the split does not fail anything by itself: the unit runner would simply start
    // running database-backed tests against whatever DATABASE_URL happens to be set, and still
    // exit 0. This is the only place that notices.
    expect(unit.filter((file) => integration.includes(file))).toEqual([])
    expect(unit.filter((file) => live.includes(file))).toEqual([])
    expect(integration.filter((file) => live.includes(file))).toEqual([])
    expect([...unit, ...integration, ...live, ...parked].sort()).toEqual(all)
    expect(all.length).toBeGreaterThan(0)
  })

  test('a suite marked @parked-test runs in neither runner but is still accounted for', async () => {
    // Capabilities that ship switched off keep their tests compiling without running them. The
    // marker lives in the test file, so switching the capability on is one deletion in one place.
    const root = await mkdtemp(join(tmpdir(), 'backend-test-files-'))
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src/live.integration.test.ts'), '')
    await writeFile(join(root, 'src/off.integration.test.ts'), '// @parked-test\n')

    const split = backendTestFiles(root)

    expect(split.parked).toEqual(['src/off.integration.test.ts'])
    expect(split.integration).toEqual(['src/live.integration.test.ts'])
    expect(split.all).toContain('src/off.integration.test.ts')
  })

  test('the marker only counts in the leading comment, not in the body', async () => {
    // Otherwise this very file - which names the marker in a test title and a fixture - could
    // park itself after an innocent reordering, taking every guard in it out of both runners
    // while the suite still exits 0.
    const root = await mkdtemp(join(tmpdir(), 'backend-test-files-'))
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/mentions.test.ts'),
      "import { test } from 'bun:test'\n\ntest('@parked-test is just a string here', () => {})\n",
    )

    expect(backendTestFiles(root).parked).toEqual([])
  })

  test('the billing suite is parked exactly while its tables are commented out', () => {
    // Discovery would otherwise run it against a database that has no billing tables. Asserted
    // against the schema rather than against a fixed list, so this holds in all three states
    // docs/IAP.md describes: subscriptions off, switched on, and removed entirely.
    const suite = 'src/modules/billing/billing.integration.test.ts'
    const schemaPath = resolve(backendRoot, 'prisma/schema/billing.prisma')

    if (!all.includes(suite) || !existsSync(schemaPath)) {
      expect(parked).toEqual([])
      return
    }

    const tablesAreCommentedOut = !/^\s*model\s/m.test(readFileSync(schemaPath, 'utf8'))

    // The exact set, not just billing's membership: a stray `@parked-test` in any other file's
    // header would otherwise drop that suite from both runners with the run still exiting 0.
    expect(parked).toEqual(tablesAreCommentedOut ? [suite] : [])
  })

  test('database-backed tests go to the integration runner, and only those', () => {
    expect(integration).toContain('src/db.integration.test.ts')
    expect(unit).toContain('src/db.test.ts')
    expect(integration.every((file) => file.includes('.integration.test.'))).toBe(true)
  })

  test('tests needing a service no runner starts stay out of the fast suite', () => {
    // `bun run test` must stay runnable with no Docker daemon. A live test landing in the unit
    // set would fail for everyone who has not started a container, and a red suite people learn
    // to ignore is worse than no suite.
    expect(live).toContain('src/storage/s3-storage.live.test.ts')
    expect(live.every((file) => file.includes('.live.test.'))).toBe(true)
    expect(unit.some((file) => file.includes('.live.test.'))).toBe(false)
    expect(live.length).toBeGreaterThan(0)
  })

})
