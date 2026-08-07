import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { backendTestFiles } from './test-files.mjs'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

describe('backendTestFiles', () => {
  const { all, parked, unit, integration } = backendTestFiles(backendRoot)

  test('every test file lands in exactly one runner, or is explicitly parked', () => {
    // Losing the split does not fail anything by itself: the unit runner would simply start
    // running database-backed tests against whatever DATABASE_URL happens to be set, and still
    // exit 0. This is the only place that notices.
    expect(unit.filter((file) => integration.includes(file))).toEqual([])
    expect([...unit, ...integration, ...parked].sort()).toEqual(all)
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

  test('the billing suite stays parked while its tables are commented out', () => {
    // Discovery would otherwise run it against a database that has no billing tables.
    expect(parked).toEqual(['src/modules/billing/billing.integration.test.ts'])
  })

  test('database-backed tests go to the integration runner, and only those', () => {
    expect(integration).toContain('src/db.integration.test.ts')
    expect(unit).toContain('src/db.test.ts')
    expect(integration.every((file) => file.includes('.integration.test.'))).toBe(true)
  })

  test('a test file that would run in no runner stops the suite', async () => {
    // The completeness check lives in the runner rather than in this file on purpose: narrowing
    // the pattern can stop this very test from running, so a test alone could never be trusted to
    // catch it. What is checked here is that the runner's own guard actually fires.
    const root = await mkdtemp(join(tmpdir(), 'backend-test-files-'))
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'prisma'), { recursive: true })
    await writeFile(join(root, 'src/kept.test.ts'), '')
    await writeFile(join(root, 'prisma/stranded.test.ts'), '')

    expect(() => backendTestFiles(root)).toThrow('prisma/stranded.test.ts')
  })

  test("a file using bun's other test-file conventions is not silently ignored", async () => {
    // `bun test` also collects *.spec.* and *_test.*; this repository standardises on *.test.*,
    // so a file named by habit must fail loudly instead of running nowhere.
    const root = await mkdtemp(join(tmpdir(), 'backend-test-files-'))
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src/habit.spec.ts'), '')

    expect(() => backendTestFiles(root)).toThrow('src/habit.spec.ts')
  })
})
