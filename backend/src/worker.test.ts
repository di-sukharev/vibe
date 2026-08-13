import { expect, spyOn, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { listenForWorkerShutdown, runNotificationsWorker, startWorkerLoops, workerMode } from './worker'

// Two runners share this process: the generic loops over the job registry, and the purpose-built
// notifications pipeline. Both are covered here.

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
      // The cleanup job reconciles push tokens before it touches sessions.
      $executeRaw: async () => 0,
      authSession: {
        deleteMany: async () => {
          calls.failures += 1
          throw new Error('cleanup exploded')
        },
      },
      passwordResetToken: { deleteMany: async () => ({ count: 0 }) },
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

test('notification worker aborts on SIGTERM and removes signal listeners on dispose', () => {
  const listeners = new Map<string, () => void>()
  const removed: string[] = []
  const shutdown = listenForWorkerShutdown({
    once(signal, listener) {
      listeners.set(signal, listener)
    },
    off(signal) {
      removed.push(signal)
    },
  })

  expect(shutdown.signal.aborted).toBe(false)
  listeners.get('SIGTERM')?.()
  expect(shutdown.signal.aborted).toBe(true)

  shutdown.dispose()
  expect(removed.sort()).toEqual(['SIGINT', 'SIGTERM'])
})

test('notification worker propagates shutdown and does not start receipt work after abort', async () => {
  const controller = new AbortController()
  let receiptChecks = 0
  let receivedMaxRuntimeMs: number | undefined
  let receivedSignal: AbortSignal | undefined

  await runNotificationsWorker(
    {
      env: { SHUTDOWN_GRACE_SECONDS: 20 },
    } as never,
    {
      notifications: {
        async processOutbox(options) {
          receivedMaxRuntimeMs = options?.maxRuntimeMs
          receivedSignal = options?.signal
          controller.abort()
          return emptyOutboxMetrics()
        },
        async checkReceipts() {
          receiptChecks += 1
          return { checked: 0, delivered: 0, failed: 0, tokensDisabled: 0 }
        },
      },
      pollIntervalMs: 1,
      signal: controller.signal,
    },
  )

  expect(receivedSignal).toBe(controller.signal)
  expect(receivedMaxRuntimeMs).toBe(15_000)
  expect(receiptChecks).toBe(0)
})

test('notification worker logs meaningful activity metrics', async () => {
  const controller = new AbortController()
  const logs: unknown[][] = []

  await runNotificationsWorker(
    {
      env: { SHUTDOWN_GRACE_SECONDS: 20 },
    } as never,
    {
      logger: {
        error() {},
        log(...values) {
          logs.push(values)
          if (values[0] === '[NotificationWorker] activity') controller.abort()
        },
      },
      notifications: {
        async processOutbox() {
          return {
            ...emptyOutboxMetrics(),
            processed: 2,
            sent: 1,
            transientFailed: 1,
          }
        },
        async checkReceipts() {
          return { checked: 2, delivered: 1, failed: 1, tokensDisabled: 1 }
        },
      },
      pollIntervalMs: 1,
      signal: controller.signal,
    },
  )

  expect(logs).toContainEqual([
    '[NotificationWorker] activity',
    {
      outbox: expect.objectContaining({
        processed: 2,
        sent: 1,
        transientFailed: 1,
      }),
      receipts: {
        checked: 2,
        delivered: 1,
        failed: 1,
        tokensDisabled: 1,
      },
    },
  ])
})

test('notification worker reports pass failures without logging an idle heartbeat', async () => {
  const controller = new AbortController()
  const errors: unknown[][] = []
  const logs: unknown[][] = []
  const failure = new Error('database unavailable')

  await runNotificationsWorker(
    {
      env: { SHUTDOWN_GRACE_SECONDS: 20 },
    } as never,
    {
      logger: {
        error(...values) {
          errors.push(values)
          controller.abort()
        },
        log(...values) {
          logs.push(values)
        },
      },
      notifications: {
        async processOutbox() {
          throw failure
        },
        async checkReceipts() {
          throw new Error('receipt work must not start after abort')
        },
      },
      pollIntervalMs: 1,
      signal: controller.signal,
    },
  )

  expect(errors).toEqual([
    ['[NotificationWorker] processPushOutbox failed:', failure],
  ])
  expect(logs.some(([message]) => message === '[NotificationWorker] heartbeat')).toBe(false)
})

test('notification worker emits a sparse heartbeat for idle polling', async () => {
  const controller = new AbortController()
  const logs: unknown[][] = []
  const clock = [0, 60_000, 299_999, 300_000]

  await runNotificationsWorker(
    {
      env: { SHUTDOWN_GRACE_SECONDS: 20 },
    } as never,
    {
      heartbeatIntervalMs: 300_000,
      logger: {
        error() {},
        log(...values) {
          logs.push(values)
          if (values[0] === '[NotificationWorker] heartbeat') controller.abort()
        },
      },
      notifications: {
        async processOutbox() {
          return emptyOutboxMetrics()
        },
        async checkReceipts() {
          return { checked: 0, delivered: 0, failed: 0, tokensDisabled: 0 }
        },
      },
      now: () => clock.shift() ?? 300_000,
      pollIntervalMs: 0,
      signal: controller.signal,
    },
  )

  expect(logs.filter(([message]) => message === '[NotificationWorker] heartbeat')).toHaveLength(1)
})

function emptyOutboxMetrics() {
  return {
    failed: 0,
    loops: 0,
    pendingCount: 0,
    processed: 0,
    requeuedStale: 0,
    sent: 0,
    skipped: 0,
    transientFailed: 0,
  }
}

test('an unrecognised worker mode is a typo, not the default', () => {
  // Falling back to the loops meant `start:worker notificaitons` ran the empty loop set and exited
  // 0 - a push worker that looks healthy and delivers nothing.
  const error = spyOn(console, 'error').mockImplementation(() => {})
  const exit = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exited')
  }) as never)

  try {
    expect(workerMode(undefined)).toBe('loops')
    expect(workerMode('notifications')).toBe('notifications')
    expect(() => workerMode('notificaitons')).toThrow('exited')
    expect(String(error.mock.calls[0]?.[0])).toContain('Available modes: loops, notifications')
  } finally {
    error.mockRestore()
    exit.mockRestore()
  }
})
