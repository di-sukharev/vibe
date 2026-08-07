import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { collectionIsEmpty } from './runner-collections.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

describe('collectionIsEmpty', () => {
  test('an annotated empty literal with a commented example is empty', () => {
    expect(
      collectionIsEmpty(
        `export const workerLoops: WorkerLoop[] = [
  // { job: 'db:ping', intervalMs: 10_000 },
]`,
        'workerLoops',
      ),
    ).toBe(true)
  })

  test('a single real entry makes it non-empty', () => {
    // The whole point of the check: a project that adds work must be allowed to deploy the
    // process. Matching the `[` of the `WorkerLoop[]` annotation instead of the array literal
    // made this look empty forever.
    expect(
      collectionIsEmpty(
        `export const workerLoops: WorkerLoop[] = [
  { job: 'db:ping', intervalMs: 10_000 },
]`,
        'workerLoops',
      ),
    ).toBe(false)
  })

  test('a URL inside an entry does not swallow the closing bracket', () => {
    // Comment stripping has to leave `https://` alone. Treating that `//` as a comment start eats
    // the rest of the line - including the `]` - and the parser then blames a rename that never
    // happened, refusing to deploy a runner that does have work.
    expect(
      collectionIsEmpty(
        `export const workerLoops: WorkerLoop[] = [{ job: 'db:ping', intervalMs: 1000, docs: 'https://example.test/runbook' }]`,
        'workerLoops',
      ),
    ).toBe(false)
  })

  test('a block comment above the declaration does not hide the entries', () => {
    expect(
      collectionIsEmpty(
        `/** See https://example.test/docs before switching this on. */
export const schedules: ScheduleEntry[] = [
  { expression: '0 3 * * *', job: 'auth:sessions:cleanup' },
]`,
        'schedules',
      ),
    ).toBe(false)
  })

  test('a renamed or reshaped collection fails loudly instead of reporting empty', () => {
    // Silently returning true would let the deploy tooling reject a populated runner forever.
    expect(() => collectionIsEmpty('export const somethingElse = []', 'schedules')).toThrow(
      'Could not find "export const schedules"',
    )
  })

  test('the shipped runners are empty, so the template never deploys a crash-looping worker', async () => {
    const [worker, scheduler] = await Promise.all([
      readFile(resolve(repositoryRoot, 'backend/src/worker.ts'), 'utf8'),
      readFile(resolve(repositoryRoot, 'backend/src/scheduler.ts'), 'utf8'),
    ])

    expect({
      workerLoops: collectionIsEmpty(worker, 'workerLoops'),
      schedules: collectionIsEmpty(scheduler, 'schedules'),
    }).toEqual({ workerLoops: true, schedules: true })
  })
})
