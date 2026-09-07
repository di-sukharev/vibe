import { describe, expect, test } from 'bun:test'

import type { EnqueueTaskInput } from '../../../outbox'
import { createPasswordResetTaskQueue } from './password-reset-task-queue'

type FakeRow = { scheduledFor: Date; status: string; type: string }

type CountArgs = { where: { scheduledFor: { lte: Date }; status: string; type: { in: string[] } } }

/**
 * Just enough of the `task_outbox` table to answer the one count the queue issues: rows with a
 * status, a type and a due time. `createMany` rows are due when the queue says they are;
 * `park` adds a row the way a retry or another task type would.
 */
function recordingQueue({ pendingLimit = 50 }: { pendingLimit?: number } = {}) {
  const queued: EnqueueTaskInput[] = []
  const counted: unknown[] = []
  const rows: FakeRow[] = []
  const prisma = {
    taskOutbox: {
      count: async (args: CountArgs) => {
        counted.push(args)
        const { scheduledFor, status, type } = args.where
        return rows.filter(
          (row) =>
            row.status === status && type.in.includes(row.type) && row.scheduledFor <= scheduledFor.lte,
        ).length
      },
      createMany: async ({ data }: { data: EnqueueTaskInput[] }) => {
        queued.push(...data)
        rows.push(
          ...data.map((task) => ({
            scheduledFor: task.scheduledFor ?? new Date(0),
            status: 'pending',
            type: task.type,
          })),
        )
        return { count: 1 }
      },
      findUniqueOrThrow: async () => ({ id: `id-${queued.length}` }),
    },
  }

  return {
    counted,
    // Every row finished: what a pass does to a batch of addresses that have no account.
    drain: () => {
      rows.splice(0)
    },
    park: (row: Partial<FakeRow>) => {
      rows.push({ scheduledFor: new Date(0), status: 'pending', type: 'auth:password-reset', ...row })
    },
    queue: createPasswordResetTaskQueue(prisma as never, { pendingLimit }),
    queued,
  }
}

describe('the password reset task queue', () => {
  test('collapses a burst from one address, then lets the next window through', async () => {
    // Without the time bucket the key would be the address alone, so a user's second reset
    // request ever would collide with the first, already-finished row and silently queue
    // nothing - locking them out of resets permanently.
    const { queue, queued } = recordingQueue()
    const first = new Date('2026-08-09T12:00:00.000Z')

    await queue.enqueuePasswordReset({ email: 'user@example.com', now: first })
    await queue.enqueuePasswordReset({ email: 'user@example.com', now: new Date(first.getTime() + 30_000) })
    await queue.enqueuePasswordReset({ email: 'user@example.com', now: new Date(first.getTime() + 90_000) })

    const keys = queued.map((task) => task.dedupeKey)
    expect(keys[0]).toBe(keys[1]!)
    expect(keys[2]).not.toBe(keys[0]!)
  })

  test('the key never carries the address, and never says whether it exists', async () => {
    const { queue, queued } = recordingQueue()
    const now = new Date('2026-08-09T12:00:00.000Z')

    await queue.enqueuePasswordReset({ email: 'User@Example.com ', now })

    const [task] = queued
    expect(task?.type).toBe('auth:password-reset')
    expect(task?.dedupeKey).not.toContain('example.com')
    expect(task?.dedupeKey).toMatch(/^[0-9a-f]{64}:\d+$/)
    // The payload keeps the address exactly as submitted; findUserByEmail is case-sensitive.
    expect(task?.payload).toEqual({ email: 'User@Example.com ' })
  })

  test('case and surrounding space do not split one address into two tasks', async () => {
    const { queue, queued } = recordingQueue()
    const now = new Date('2026-08-09T12:00:00.000Z')

    await queue.enqueuePasswordReset({ email: 'user@example.com', now })
    await queue.enqueuePasswordReset({ email: ' USER@Example.com ', now })

    expect(queued[0]?.dedupeKey).toBe(queued[1]!.dedupeKey)
  })

  test('stops writing once the waiting batch is full, and resumes when the drain empties it', async () => {
    // The request path admits any address, so what arrives here is bounded only by the auth rate
    // limit times the addresses an attacker holds, while the drain moves a fixed number of rows a
    // minute. Without a ceiling a flood of fresh addresses outruns the drain for as long as it
    // lasts, and every real reset queues behind it.
    const { drain, queue, queued } = recordingQueue({ pendingLimit: 2 })
    const now = new Date('2026-08-09T12:00:00.000Z')

    await queue.enqueuePasswordReset({ email: 'first@example.com', now })
    await queue.enqueuePasswordReset({ email: 'second@example.com', now })
    // Refused quietly: the caller answers 202 either way, so this must not throw.
    await expect(queue.enqueuePasswordReset({ email: 'third@example.com', now })).resolves.toBeUndefined()
    expect(queued.map((task) => task.payload)).toEqual([
      { email: 'first@example.com' },
      { email: 'second@example.com' },
    ])

    drain()
    await queue.enqueuePasswordReset({ email: 'third@example.com', now })
    expect(queued).toHaveLength(3)
  })

  test('only rows the next pass can claim count against the ceiling', async () => {
    // A failed delivery parks its row as pending with a due time minutes ahead. Counting those
    // would let a provider outage fill the ceiling with real resets in backoff and then drop
    // every new request for as long as the outage lasts. Other task types share the table and
    // the status, and have their own budget.
    // Enough of each kind to fill the ceiling on its own, so counting either would refuse.
    const { park, queue, queued } = recordingQueue({ pendingLimit: 2 })
    const now = new Date('2026-08-09T12:00:00.000Z')
    const retryAt = new Date(now.getTime() + 120_000)
    park({ scheduledFor: retryAt })
    park({ scheduledFor: retryAt })
    park({ type: 'auth:password-changed' })
    park({ type: 'auth:password-changed' })

    await queue.enqueuePasswordReset({ email: 'user@example.com', now })
    expect(queued).toHaveLength(1)

    // Once the retries are due they are claimable, so they fill the batch like any other row.
    const retriesDue = new Date(retryAt.getTime() + 60_000)
    await queue.enqueuePasswordReset({ email: 'other@example.com', now: retriesDue })
    expect(queued).toHaveLength(1)
  })

  test('the ceiling is read the same way for every address', async () => {
    // One query, keyed on nothing the caller submitted: the check happens before the address is
    // looked at, so neither its cost nor its outcome can say whether an account exists.
    const { counted, queue } = recordingQueue()
    const now = new Date('2026-08-09T12:00:00.000Z')

    await queue.enqueuePasswordReset({ email: 'user@example.com', now })
    await queue.enqueuePasswordReset({ email: 'nobody@example.org', now })

    expect(counted).toHaveLength(2)
    expect(counted[0]).toEqual(counted[1]!)
    expect(JSON.stringify(counted)).not.toMatch(/example\.(com|org)|user|nobody/)
  })
})
