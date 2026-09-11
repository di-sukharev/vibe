import { describe, expect, spyOn, test } from 'bun:test'

import { loadEnv } from './env'
import type { BackendRuntime } from './runtime'
import { backgroundJobNames, runBackgroundJob } from './jobs'

const runtime = {} as BackendRuntime

describe('runBackgroundJob', () => {
  test('rejects an unknown job and names the ones that exist', async () => {
    // All three runners take job names from user input or config, so a typo has to fail loudly
    // with the list of real names rather than silently do nothing. Checked against the registry
    // rather than a copy of it: adding a job must not break this test, or the next person to add
    // one edits the string instead of reading why it is here.
    const names = backgroundJobNames()
    const failure = await runBackgroundJob('missing', runtime).catch((error: unknown) => error)

    expect(names.length).toBeGreaterThan(1)
    expect(String(failure)).toContain('Unknown job "missing"')
    for (const name of names) expect(String(failure)).toContain(name)
  })

  test('outbox:drain reaches the outbox and reports what it did', async () => {
    // The registry loads the outbox with `await import()`, so a broken path or a renamed export
    // would only surface at runtime, on a schedule, in production.
    const { createFakeOutboxRuntime, taskRow } = await import('./outbox/fake-outbox-prisma')
    const rows = [taskRow({ id: 'a', type: 'shipped:later' })]
    const drainRuntime = createFakeOutboxRuntime(rows)
    const log = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runBackgroundJob('outbox:drain', {
        ...drainRuntime,
        env: loadEnv({
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
          JWT_SECRET: '12345678901234567890123456789012',
        }),
      } as BackendRuntime)

      expect(log).toHaveBeenCalledWith(
        'Job outbox:drain completed.',
        expect.objectContaining({ backlog: 0, claimed: 0, unhandled: 1 }),
      )
    } finally {
      log.mockRestore()
    }
  })

  test('rejects Object.prototype keys instead of running nothing and reporting success', async () => {
    // `'constructor' in backgroundJobs` is true. A provider timer configured with that name would
    // exit 0 every night while doing no work at all, which looks healthy in every dashboard.
    for (const inherited of ['constructor', 'toString', 'hasOwnProperty']) {
      await expect(runBackgroundJob(inherited, runtime)).rejects.toThrow(
        `Unknown job "${inherited}"`,
      )
    }
  })

  describe('uploads:pending:cleanup', () => {
    const expired = [
      { id: 'upload-1', objectKey: 'avatars/2026/07/one' },
      { id: 'upload-2', objectKey: 'avatars/2026/07/two' },
    ]

    function createCleanupRuntime({ failingKey }: { failingKey?: string } = {}) {
      const calls: { findMany: unknown[]; deleteMany: unknown[]; deletedObjects: string[] } = {
        findMany: [],
        deleteMany: [],
        deletedObjects: [],
      }

      const runtime = {
        prisma: {
          userAvatar: {
            findMany: async (input: unknown) => {
              calls.findMany.push(input)
              return expired
            },
            deleteMany: async (input: { where: { id: { in: string[] } } }) => {
              calls.deleteMany.push(input)
              return { count: input.where.id.in.length }
            },
          },
        },
        privateStorage: {
          storage: {
            deleteObject: async (objectKey: string) => {
              if (objectKey === failingKey) throw new Error('storage unavailable')
              calls.deletedObjects.push(objectKey)
            },
          },
        },
      } as unknown as BackendRuntime

      return { calls, runtime }
    }

    test('collects pending uploads whose signed URL expired over an hour ago', async () => {
      const { calls, runtime: cleanupRuntime } = createCleanupRuntime()
      const now = new Date('2026-08-09T12:00:00.000Z')

      await runBackgroundJob('uploads:pending:cleanup', cleanupRuntime, now)

      // Only the cutoff is asserted. Slack past expiry covers clock skew between the app and the
      // database; finalize already refuses an expired upload, so this is not what protects the
      // boundary. Restating `orderBy` and `take` would only check the query was transcribed.
      expect(calls.findMany).toHaveLength(1)
      expect((calls.findMany[0] as { where: unknown }).where).toEqual({
        state: 'pending',
        expiresAt: { lt: new Date('2026-08-09T11:00:00.000Z') },
      })
    })

    test('removes the stored object before the row that points at it', async () => {
      const { calls, runtime: cleanupRuntime } = createCleanupRuntime()

      await runBackgroundJob('uploads:pending:cleanup', cleanupRuntime, new Date())

      expect(calls.deletedObjects).toEqual(['avatars/2026/07/one', 'avatars/2026/07/two'])
      expect(calls.deleteMany).toEqual([
        { where: { id: { in: ['upload-1', 'upload-2'] } } },
      ])
    })

    test('keeps the row when its object could not be deleted, so the next run retries', async () => {
      // The row is the only record of the object key. Deleting it after a failed object delete
      // would strand that object forever, which is the exact leak this ordering exists to avoid.
      const { calls, runtime: cleanupRuntime } = createCleanupRuntime({
        failingKey: 'avatars/2026/07/one',
      })
      const error = spyOn(console, 'error').mockImplementation(() => {})

      try {
        await runBackgroundJob('uploads:pending:cleanup', cleanupRuntime, new Date())

        expect(calls.deletedObjects).toEqual(['avatars/2026/07/two'])
        expect(calls.deleteMany).toEqual([{ where: { id: { in: ['upload-2'] } } }])
        expect(error).toHaveBeenCalledWith(
          'Job uploads:pending:cleanup could not delete avatars/2026/07/one:',
          expect.any(Error),
        )
      } finally {
        error.mockRestore()
      }
    })

    test('does not issue a delete when every object failed', async () => {
      const { calls, runtime: cleanupRuntime } = createCleanupRuntime()
      const runtimeAllFailing = {
        ...cleanupRuntime,
        privateStorage: {
          storage: {
            deleteObject: async () => {
              throw new Error('storage unavailable')
            },
          },
        },
      } as unknown as BackendRuntime
      const error = spyOn(console, 'error').mockImplementation(() => {})

      try {
        await runBackgroundJob('uploads:pending:cleanup', runtimeAllFailing, new Date())

        expect(calls.deleteMany).toEqual([])
        expect(error).toHaveBeenCalledTimes(2)
        expect(error.mock.calls.map(([message]) => String(message))).toEqual([
          'Job uploads:pending:cleanup could not delete avatars/2026/07/one:',
          'Job uploads:pending:cleanup could not delete avatars/2026/07/two:',
        ])
      } finally {
        error.mockRestore()
      }
    })
  })

  test('deletes expired and revoked auth sessions after the retention window', async () => {
    const sessionCalls: unknown[] = []
    const resetTokenCalls: unknown[] = []
    const rateLimitCalls: unknown[] = []
    const cleanupRuntime = {
      env: { SESSION_ABSOLUTE_TTL_DAYS: 90, SESSION_RETENTION_DAYS: 7 },
      prisma: {
        authSession: {
          deleteMany: async (input: unknown) => {
            sessionCalls.push(input)
            return { count: 2 }
          },
        },
        passwordResetToken: {
          deleteMany: async (input: unknown) => {
            resetTokenCalls.push(input)
            return { count: 3 }
          },
        },
        rateLimitBucket: {
          deleteMany: async (input: unknown) => {
            rateLimitCalls.push(input)
            return { count: 4 }
          },
        },
      },
    } as unknown as BackendRuntime

    const now = new Date('2026-04-08T12:00:00.000Z')
    await runBackgroundJob('auth:sessions:cleanup', cleanupRuntime, now)

    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0]).toMatchObject({
      where: {
        OR: [
          { expiresAt: { lt: expect.any(Date) } },
          { revokedAt: { lt: expect.any(Date) } },
          { createdAt: { lt: new Date('2026-01-01T12:00:00.000Z') } },
        ],
      },
    })
    expect(resetTokenCalls).toEqual([{
      where: { expiresAt: { lt: now } },
    }])
    // A rate-limit window nobody can land in any more is dead weight; the job that already sweeps
    // auth's other expiring rows sweeps these too, so shared counters need no runner of their own.
    expect(rateLimitCalls).toEqual([{
      where: { expiresAt: { lt: now } },
    }])
  })
})
