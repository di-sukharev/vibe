import { expect, spyOn, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { listenForWorkerShutdown, runNotificationsWorker, startWorkerLoops, workerMode } from './worker'

test('stopping wakes every sleeping loop, not just the last one', async () => {
  // A single shared waker used to leave the other loops asleep, so SIGTERM hung for a full
  // interval and the process was killed before it could close the database.
  const runtime = { prisma: { $queryRaw: async () => [{ '?column?': 1 }] } } as unknown as BackendRuntime
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

test('SIGTERM aborts the worker, and dispose releases both signal listeners', () => {
  // `main` hands this signal to either mode; the loops and the notifications pipeline stop on it.
  const listeners = new Map<string, () => void>()
  const removed: string[] = []
  const shutdown = listenForWorkerShutdown({
    once: (signal, listener) => void listeners.set(signal, listener),
    off: (signal) => void removed.push(signal),
  })

  expect(shutdown.signal.aborted).toBe(false)
  listeners.get('SIGTERM')?.()
  expect(shutdown.signal.aborted).toBe(true)

  shutdown.dispose()
  expect(removed.sort()).toEqual(['SIGINT', 'SIGTERM'])
})

// `bun src/worker.ts notifications` runs the push pipeline instead of the loops. The pipeline is
// faked here; what it does to the database is covered by notifications.integration.test.ts.
const notificationsRuntime = { env: { SHUTDOWN_GRACE_SECONDS: 20 } } as unknown as BackendRuntime
const quietLogger = { error: () => {}, log: () => {} }
const noReceipts = { checked: 0, delivered: 0, failed: 0, tokensDisabled: 0 }

test('a notifications pass gets the shutdown signal and a budget inside the grace period', async () => {
  // A batch still sending when the platform's grace period runs out is killed mid-send, so the
  // pass may use the 20 s grace minus 5 s kept for the rest of shutdown. Once aborted, the worker
  // starts no receipt check.
  const controller = new AbortController()
  let receivedMaxRuntimeMs: number | undefined
  let receivedSignal: AbortSignal | undefined
  let receiptChecks = 0

  await runNotificationsWorker(notificationsRuntime, {
    logger: quietLogger,
    notifications: {
      async processOutbox(options) {
        receivedMaxRuntimeMs = options?.maxRuntimeMs
        receivedSignal = options?.signal
        controller.abort()
        return emptyOutboxMetrics()
      },
      async checkReceipts() {
        receiptChecks += 1
        return noReceipts
      },
    },
    pollIntervalMs: 1,
    signal: controller.signal,
  })

  expect(receivedSignal).toBe(controller.signal)
  expect(receivedMaxRuntimeMs).toBe(15_000)
  expect(receiptChecks).toBe(0)
})

test('a failing notifications pass is reported and the next pass still runs', async () => {
  const controller = new AbortController()
  const errors: unknown[][] = []
  let passes = 0

  await runNotificationsWorker(notificationsRuntime, {
    logger: { ...quietLogger, error: (...values: unknown[]) => void errors.push(values) },
    notifications: {
      async processOutbox() {
        passes += 1
        if (passes === 1) throw new Error('database unavailable')
        controller.abort()
        return emptyOutboxMetrics()
      },
      async checkReceipts() {
        return noReceipts
      },
    },
    pollIntervalMs: 0,
    signal: controller.signal,
  })

  expect(errors).toHaveLength(1)
  expect(passes).toBe(2)
})

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
    expect(exit).toHaveBeenCalledWith(1)
  } finally {
    error.mockRestore()
    exit.mockRestore()
  }
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
