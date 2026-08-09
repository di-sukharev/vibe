import { describe, expect, test } from 'bun:test'

import type { EnqueueTaskInput } from '../../../outbox'
import { createPasswordResetTaskQueue } from './password-reset-task-queue'

function recordingQueue() {
  const queued: EnqueueTaskInput[] = []
  const prisma = {
    taskOutbox: {
      createMany: async ({ data }: { data: EnqueueTaskInput[] }) => {
        queued.push(...data)
        return { count: 1 }
      },
      findUniqueOrThrow: async () => ({ id: `id-${queued.length}` }),
    },
  }

  return { queue: createPasswordResetTaskQueue(prisma as never), queued }
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
})
