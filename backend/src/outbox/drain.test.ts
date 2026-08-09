import { describe, expect, spyOn, test } from 'bun:test'

import { drainTaskOutbox } from './drain'
import { TerminalTaskError } from './errors'
import { createFakeOutboxRuntime, taskRow, type FakeTaskRow } from './fake-outbox-prisma'
import type { TaskHandlerRegistry } from './handlers'

const now = new Date('2026-08-09T12:00:00.000Z')
const noJitter = () => 0

function registry(run: TaskHandlerRegistry['string']['run'], entry: Partial<{ maxAttempts: number }> = {}) {
  return { 'test:work': { run, ...entry } } satisfies TaskHandlerRegistry
}

async function drain(rows: FakeTaskRow[], handlers: TaskHandlerRegistry, options = {}) {
  return drainTaskOutbox(createFakeOutboxRuntime(rows), {
    clock: () => now,
    handlers,
    now,
    random: noJitter,
    ...options,
  })
}

describe('drainTaskOutbox', () => {
  test('runs a due task and leaves an audit skeleton without its payload', async () => {
    const rows = [taskRow({ id: 'a', type: 'test:work', payload: { email: 'a@example.com' } })]
    const seen: unknown[] = []

    const metrics = await drain(rows, registry(async ({ payload }) => void seen.push(payload)))

    expect(seen).toEqual([{ email: 'a@example.com' }])
    expect(metrics).toMatchObject({ claimed: 1, done: 1, skipped: 0, backlog: 0 })
    expect(rows[0]).toMatchObject({
      attempts: 1,
      processingToken: null,
      redactedAt: now,
      status: 'done',
    })
    // Not inside toMatchObject: `{}` there is a subset match and would accept any payload.
    expect(rows[0]?.payload).toEqual({})
  })

  test('a handler that deliberately did nothing is skipped, not counted as done', async () => {
    // Without this split, a system where every task finds nothing to do looks healthy.
    const rows = [taskRow({ id: 'a', type: 'test:work' })]

    const metrics = await drain(rows, registry(async () => 'skipped'))

    expect(metrics).toMatchObject({ done: 0, skipped: 1 })
    expect(rows[0]?.status).toBe('skipped')
  })

  test('a stale lease is recovered before any claim, and does not burn an attempt', async () => {
    // A deploy that kills a drain mid-pass must not spend one of the retries the caller was
    // promised, so `attempts` survives the recovery untouched.
    const rows = [
      taskRow({
        id: 'a',
        type: 'test:work',
        attempts: 2,
        processingToken: 'gone',
        status: 'processing',
        updatedAt: new Date(now.getTime() - 10 * 60 * 1000),
      }),
    ]
    let attemptSeen = 0

    const metrics = await drain(
      rows,
      registry(async ({ attempt }) => void (attemptSeen = attempt)),
    )

    expect(metrics.recoveredStale).toBe(1)
    expect(attemptSeen).toBe(3)
    expect(rows[0]).toMatchObject({ attempts: 3, status: 'done' })
  })

  test('a lease that is still fresh is left alone', async () => {
    const rows = [
      taskRow({
        id: 'a',
        type: 'test:work',
        processingToken: 'held',
        status: 'processing',
        updatedAt: new Date(now.getTime() - 5_000),
      }),
    ]

    const metrics = await drain(rows, registry(async () => undefined))

    expect(metrics).toMatchObject({ recoveredStale: 0, claimed: 0 })
    expect(rows[0]?.status).toBe('processing')
  })

  test('a failing task is retried later with the attempt counted', async () => {
    const rows = [taskRow({ id: 'a', type: 'test:work' })]

    const metrics = await drain(rows, registry(async () => {
      throw new Error('provider unavailable')
    }))

    expect(metrics).toMatchObject({ transientFailed: 1, terminalFailed: 0 })
    expect(rows[0]).toMatchObject({
      attempts: 1,
      lastError: 'provider unavailable',
      processedAt: null,
      processingToken: null,
      status: 'pending',
    })
    expect(rows[0]!.scheduledFor.getTime()).toBe(now.getTime() + 120_000)
    // The payload survives a retry: the next attempt needs it.
    expect(rows[0]?.redactedAt).toBeNull()
  })

  test('the last permitted attempt gives up instead of scheduling another', async () => {
    const rows = [taskRow({ id: 'a', type: 'test:work', attempts: 2 })]
    const error = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const metrics = await drain(
        rows,
        registry(async () => {
          throw new Error('still failing')
        }, { maxAttempts: 3 }),
      )

      expect(metrics).toMatchObject({ terminalFailed: 1, transientFailed: 0 })
      expect(rows[0]).toMatchObject({ attempts: 3, redactedAt: now, status: 'failed' })
    } finally {
      error.mockRestore()
    }
  })

  test('a handler that knows the work can never succeed stops immediately', async () => {
    const rows = [taskRow({ id: 'a', type: 'test:work' })]
    const error = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const metrics = await drain(rows, registry(async () => {
        throw new TerminalTaskError('payload will never validate')
      }))

      // One attempt of five, but no retry: the handler opted out.
      expect(metrics).toMatchObject({ terminalFailed: 1 })
      expect(rows[0]).toMatchObject({ attempts: 1, status: 'failed' })
    } finally {
      error.mockRestore()
    }
  })

  test('the handler is told when this is its last chance', async () => {
    // Compensating work - invalidating a reset token, say - has to happen on the final attempt
    // and must not happen before it.
    const rows = [taskRow({ id: 'a', type: 'test:work', attempts: 1 })]
    const flags: boolean[] = []

    await drain(rows, registry(async ({ finalAttempt }) => void flags.push(finalAttempt), { maxAttempts: 2 }))

    expect(flags).toEqual([true])
  })

  test('a type this deployment cannot run is left pending and reported', async () => {
    // An API already enqueueing work the runner beside it does not know yet. Claiming it would
    // burn attempts on something no handler here can ever do.
    const rows = [taskRow({ id: 'a', type: 'shipped:later' })]

    const metrics = await drain(rows, registry(async () => undefined))

    expect(metrics).toMatchObject({ claimed: 0, unhandled: 1 })
    expect(rows[0]?.status).toBe('pending')
  })

  test('work that is not due yet is left for a later pass', async () => {
    const rows = [
      taskRow({ id: 'a', type: 'test:work', scheduledFor: new Date(now.getTime() + 60_000) }),
    ]

    const metrics = await drain(rows, registry(async () => undefined))

    expect(metrics).toMatchObject({ claimed: 0, backlog: 0 })
    expect(rows[0]?.status).toBe('pending')
  })

  test('the runtime budget stops a pass between items rather than mid-task', async () => {
    const rows = [1, 2, 3].map((n) => taskRow({ id: `row-${n}`, type: 'test:work' }))
    let ran = 0

    const metrics = await drain(
      rows,
      registry(async () => {
        ran += 1
        await Bun.sleep(12)
      }),
      { maxRuntimeMs: 15 },
    )

    expect(ran).toBeLessThan(3)
    expect(metrics.backlog).toBeGreaterThan(0)
    // Whatever it did start, it finished and recorded.
    expect(rows.filter((row) => row.status === 'done')).toHaveLength(ran)
  })

  test('backlog and the oldest wait are reported for alerting', async () => {
    const rows = [
      taskRow({ id: 'a', type: 'test:work', scheduledFor: new Date(now.getTime() - 300_000) }),
      taskRow({ id: 'b', type: 'test:work' }),
    ]

    const metrics = await drain(rows, registry(async () => undefined), { limit: 1, maxRuntimeMs: 0 })

    expect(metrics).toMatchObject({ backlog: 2, claimed: 0, oldestPendingAgeSeconds: 300 })
  })

  test('terminal rows are deleted once they are older than the retention window', async () => {
    const rows = [
      taskRow({
        id: 'recent',
        type: 'test:work',
        processedAt: new Date(now.getTime() - 1_000),
        redactedAt: now,
        status: 'done',
      }),
      taskRow({
        id: 'ancient',
        type: 'test:work',
        processedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
        redactedAt: now,
        status: 'done',
      }),
    ]

    const metrics = await drain(rows, registry(async () => undefined))

    expect(metrics).toMatchObject({ deleted: 1 })
    expect(rows.map((row) => row.id)).toEqual(['recent'])
  })
})

test('a retry is scheduled from the attempt, not from the start of a long pass', async () => {
  // The password-reset cooldown starts when the token row is written, which is real time. If the
  // backoff were measured from pass start, a pass that had already been running for longer than
  // the cooldown would schedule the retry inside it, where the handler skips it and the work is
  // silently lost - the exact failure this whole table exists to prevent.
  const passStartedAt = new Date('2026-08-09T12:00:00.000Z')
  const attemptAt = new Date('2026-08-09T12:04:00.000Z')
  const rows = [taskRow({ id: 'a', type: 'test:work', scheduledFor: passStartedAt })]

  await drainTaskOutbox(createFakeOutboxRuntime(rows), {
    clock: () => attemptAt,
    handlers: registry(async () => {
      throw new Error('provider unavailable')
    }),
    now: passStartedAt,
    random: noJitter,
  })

  expect(rows[0]?.scheduledFor).toEqual(new Date(attemptAt.getTime() + 120_000))
})

test('a result that cannot be written down does not abort the pass', async () => {
  // The side effect already happened. Leaving the row for lease recovery is survivable; losing
  // the rest of the batch is not.
  const rows = [
    taskRow({ id: 'a', type: 'test:work' }),
    taskRow({ id: 'b', type: 'test:work' }),
  ]
  const runtime = createFakeOutboxRuntime(rows)
  const fake = runtime.prisma.taskOutbox as unknown as {
    updateMany: (args: { where: Record<string, unknown>; data: unknown }) => Promise<unknown>
  }
  const realUpdateMany = fake.updateMany.bind(fake)
  fake.updateMany = async (args) => {
    if (args.where.processingToken && args.where.id === 'a') throw new Error('connection reset')
    return realUpdateMany(args)
  }
  const error = spyOn(console, 'error').mockImplementation(() => {})

  try {
    const metrics = await drainTaskOutbox(runtime, {
      clock: () => now,
      handlers: registry(async () => undefined),
      now,
      random: noJitter,
    })

    expect(metrics).toMatchObject({ claimed: 2, done: 1 })
    expect(rows.find((row) => row.id === 'a')?.status).toBe('processing')
    expect(rows.find((row) => row.id === 'b')?.status).toBe('done')
    expect(String(error.mock.calls[0]?.[0])).toContain('could not be recorded')
  } finally {
    error.mockRestore()
  }
})

test('a handler that ignores its deadline does not stop the outbox', async () => {
  // The signal is a request, not a guarantee - Prisma calls take no signal at all. Without a
  // race the pass would never resolve, the scheduler's tick would never finish, and croner's
  // overlap guard would suppress every later tick with nothing in the log.
  const rows = [
    taskRow({ id: 'stuck', type: 'test:work', payload: { hang: true } }),
    taskRow({ id: 'next', type: 'test:work', payload: { hang: false } }),
  ]
  const error = spyOn(console, 'error').mockImplementation(() => {})
  let released: (() => void) | undefined

  try {
    const metrics = await drainTaskOutbox(createFakeOutboxRuntime(rows), {
      clock: () => now,
      handlers: {
        'test:work': {
          deadlineMs: 20,
          run: async ({ payload }) =>
            (payload as { hang: boolean }).hang
              ? new Promise<undefined>((resolve) => {
                  released = () => resolve(undefined)
                })
              : undefined,
        },
      },
      now,
      random: noJitter,
    })

    // The pass finished despite the hung handler, and the row behind it still ran.
    expect(metrics).toMatchObject({ claimed: 2, done: 1, transientFailed: 1 })
    expect(rows.find((row) => row.id === 'stuck')?.status).toBe('pending')
    expect(rows.find((row) => row.id === 'next')?.status).toBe('done')
  } finally {
    released?.()
    error.mockRestore()
  }
}, 5_000)

test('an over-deadline attempt is retried rather than lost', async () => {
  const rows = [taskRow({ id: 'slow', type: 'test:work' })]
  let release: (() => void) | undefined

  try {
    const metrics = await drainTaskOutbox(createFakeOutboxRuntime(rows), {
      clock: () => now,
      handlers: {
        'test:work': {
          deadlineMs: 20,
          run: () =>
            new Promise<undefined>((resolve) => {
              release = () => resolve(undefined)
            }),
        },
      },
      now,
      random: noJitter,
    })

    expect(metrics).toMatchObject({ claimed: 1, transientFailed: 1 })
    expect(rows[0]).toMatchObject({ attempts: 1, status: 'pending' })
    expect(rows[0]?.lastError).toContain('did not finish within its 20ms deadline')
  } finally {
    release?.()
  }
}, 5_000)

test('the lease floor is applied, not merely available', async () => {
  // A lease shorter than an attempt would let a second drain claim a row whose first runner is
  // still working. The floor is a pure function, but it has to actually be called with the
  // slowest handler deadline - otherwise an operator setting a tiny lease breaks the invariant.
  const rows = [
    taskRow({
      id: 'held',
      type: 'test:work',
      processingToken: 'someone-else',
      status: 'processing',
      updatedAt: new Date(now.getTime() - 20_000),
    }),
  ]

  const metrics = await drainTaskOutbox(createFakeOutboxRuntime(rows), {
    clock: () => now,
    handlers: { 'test:work': { deadlineMs: 30_000, run: async () => undefined } },
    // Absurdly short on purpose: the floor must override it.
    leaseStaleMs: 1,
    now,
    random: noJitter,
  })

  expect(metrics.recoveredStale).toBe(0)
  expect(rows[0]?.status).toBe('processing')
})
