import { expect, spyOn, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { startWorkerLoops } from './worker'

function pingRuntime() {
  const calls = { pings: 0 }
  const runtime = {
    prisma: {
      $queryRaw: async () => {
        calls.pings += 1
        return [{ '?column?': 1 }]
      },
    },
  } as unknown as BackendRuntime

  return { calls, runtime }
}

test('a worker loop keeps running its job until it is stopped', async () => {
  const { calls, runtime } = pingRuntime()
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    const handle = startWorkerLoops(runtime, [{ job: 'db:ping', intervalMs: 1 }])
    await new Promise((resolve) => setTimeout(resolve, 20))
    handle.stop()
    await handle.stopped

    // A cron cannot do this: its finest granularity is one minute.
    expect(calls.pings).toBeGreaterThan(1)
  } finally {
    log.mockRestore()
  }
})

test('stopping wakes every sleeping loop, not just the last one', async () => {
  // A single shared waker used to leave the other loops asleep, so SIGTERM hung for a full
  // interval and the process was killed before it could close the database.
  const { runtime } = pingRuntime()
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    const handle = startWorkerLoops(runtime, [
      { job: 'db:ping', intervalMs: 30_000 },
      { job: 'noop', intervalMs: 30_000 },
    ])
    await new Promise((resolve) => setTimeout(resolve, 10))

    const stoppedAt = Date.now()
    handle.stop()
    await handle.stopped

    expect(Date.now() - stoppedAt).toBeLessThan(1_000)
  } finally {
    log.mockRestore()
  }
})

test('loops run side by side and survive a failing neighbour', async () => {
  const calls = { pings: 0, failures: 0 }
  const runtime = {
    prisma: {
      $queryRaw: async () => {
        calls.pings += 1
        return [{ '?column?': 1 }]
      },
      authSession: {
        deleteMany: async () => {
          calls.failures += 1
          throw new Error('cleanup exploded')
        },
      },
      passwordResetToken: { deleteMany: async () => ({ count: 0 }) },
      rateLimitBucket: { deleteMany: async () => ({ count: 0 }) },
    },
    env: { SESSION_RETENTION_DAYS: 7, SESSION_ABSOLUTE_TTL_DAYS: 90 },
  } as unknown as BackendRuntime
  const log = spyOn(console, 'log').mockImplementation(() => {})
  const error = spyOn(console, 'error').mockImplementation(() => {})

  try {
    const handle = startWorkerLoops(runtime, [
      { job: 'db:ping', intervalMs: 1 },
      { job: 'auth:sessions:cleanup', intervalMs: 1 },
    ])
    await new Promise((resolve) => setTimeout(resolve, 20))
    handle.stop()
    await handle.stopped

    expect(calls.pings).toBeGreaterThan(1)
    expect(calls.failures).toBeGreaterThan(1)
    expect(error).toHaveBeenCalled()
  } finally {
    log.mockRestore()
    error.mockRestore()
  }
})

test('a single-instance loop skips its turn while another instance holds the lock', async () => {
  // Loops run unlocked by default; opting in must actually reach the database lock, otherwise
  // scaling the worker to two instances silently doubles the work.
  const calls = { transactions: 0, pings: 0 }
  const runtime = {
    prisma: {
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        calls.transactions += 1
        return run({ $queryRaw: async () => [{ acquired: false }] })
      },
      $queryRaw: async () => {
        calls.pings += 1
        return [{ '?column?': 1 }]
      },
    },
  } as unknown as BackendRuntime
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    const handle = startWorkerLoops(runtime, [
      { job: 'db:ping', intervalMs: 1, singleInstance: true },
    ])
    await new Promise((resolve) => setTimeout(resolve, 20))
    handle.stop()
    await handle.stopped

    expect(calls.transactions).toBeGreaterThan(1)
    expect(calls.pings).toBe(0)
    expect(log).toHaveBeenCalledWith('Worker skipped db:ping: its lock is held elsewhere.')
  } finally {
    log.mockRestore()
  }
})

test('stopping during a running iteration does not wait out the interval that follows', async () => {
  // Without the running check between the iteration and the sleep, a stop signal that arrives
  // mid-iteration is only noticed a full interval later - long enough for a platform to SIGKILL
  // the container before it can close the database.
  const release = Promise.withResolvers<void>()
  const runtime = {
    prisma: {
      $queryRaw: async () => {
        release.resolve()
        return [{ '?column?': 1 }]
      },
    },
  } as unknown as BackendRuntime
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    const handle = startWorkerLoops(runtime, [{ job: 'db:ping', intervalMs: 30_000 }])
    await release.promise

    const stoppedAt = Date.now()
    handle.stop()
    await handle.stopped

    expect(Date.now() - stoppedAt).toBeLessThan(1_000)
  } finally {
    log.mockRestore()
  }
})
