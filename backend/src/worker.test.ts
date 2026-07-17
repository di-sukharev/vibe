import { expect, test } from 'bun:test'

import { listenForWorkerShutdown, runNotificationsWorker } from './worker'

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
