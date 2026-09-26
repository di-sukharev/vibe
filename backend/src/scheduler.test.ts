import { expect, spyOn, test } from 'bun:test'

import scheduleDefinitions from './job-schedules.json' with { type: 'json' }
import { runScheduledJob, startSchedules, type ScheduleEntry } from './scheduler'
import type { BackendRuntime } from './runtime'

const pingEntry: ScheduleEntry = { expression: '* * * * *', job: 'db:ping' }

test('every schedule holds its lock longer than the provider lets one run last', () => {
  // Otherwise a run still inside its execution timeout can lose the lock, and the next timer
  // starts the same job a second time.
  expect(
    scheduleDefinitions.every(
      ({ lockTimeoutMs, yandexExecutionTimeoutSeconds }) =>
        lockTimeoutMs > yandexExecutionTimeoutSeconds * 1_000,
    ),
  ).toBe(true)
})

test('a failing job is reported and does not escape the scheduler', async () => {
  const runtime = {
    prisma: {
      $transaction: async () => {
        throw new Error('database is unreachable')
      },
    },
  } as unknown as BackendRuntime
  const error = spyOn(console, 'error').mockImplementation(() => {})

  try {
    // No rejection: the next tick must still happen.
    await runScheduledJob(runtime, pingEntry)

    expect(error).toHaveBeenCalled()
    expect(String(error.mock.calls[0]?.[0])).toContain('db:ping')
  } finally {
    error.mockRestore()
  }
})

test('schedules default to UTC so a server timezone cannot move production runs', () => {
  const { jobs } = startSchedules({} as BackendRuntime, [
    { expression: '0 3 * * *', job: 'noop' },
    { expression: '0 3 * * *', job: 'db:ping', timeZone: 'Europe/Moscow' },
  ])
  const [utc, explicit] = jobs.map((job) => job.cron)

  try {
    expect(utc?.options.timezone).toBe('UTC')
    expect(explicit?.options.timezone).toBe('Europe/Moscow')
    // Same wall-clock expression, different zones, so the next runs cannot coincide.
    expect(utc?.nextRun()?.getTime()).not.toBe(explicit?.nextRun()?.getTime())
  } finally {
    utc?.stop()
    explicit?.stop()
  }
})

test('shutdown waits for a job that is already running', async () => {
  // Stopping the timers is not enough: cutting a running job off would leave it half-done with
  // neither a success nor a failure recorded anywhere.
  const release = Promise.withResolvers<void>()
  let finished = false
  const runtime = {
    prisma: {
      $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
        run({ $queryRaw: async () => [{ acquired: true }] }),
      $queryRaw: async () => {
        await release.promise
        finished = true
        return [{ '?column?': 1 }]
      },
    },
  } as unknown as BackendRuntime
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    const handle = startSchedules(runtime, [{ expression: '0 3 * * *', job: 'db:ping' }])
    // Started by hand rather than by waiting for a real tick.
    void handle.jobs[0]?.cron.trigger()

    let drained = false
    const drain = handle.stop().then(() => {
      drained = true
    })

    await Bun.sleep(50)
    expect({ drained, finished }).toEqual({ drained: false, finished: false })

    release.resolve()
    await drain
    expect({ drained, finished }).toEqual({ drained: true, finished: true })
  } finally {
    log.mockRestore()
  }
})

test('one job can be scheduled more than once', () => {
  // A weekday/weekend split, or the same job in two timezones. croner throws on a repeated job
  // name, and that throw would happen at startup, before any signal handler exists - a supervised
  // process would then restart-loop with every schedule dead.
  const handle = startSchedules({} as BackendRuntime, [
    { expression: '0 9 * * 1-5', job: 'auth:sessions:cleanup' },
    { expression: '0 12 * * 6,0', job: 'auth:sessions:cleanup' },
  ])

  try {
    expect(
      handle.jobs.map((job) => job.cron.nextRun()?.getTime()),
    ).not.toContain(undefined)
    expect(handle.jobs).toHaveLength(2)
  } finally {
    void handle.stop()
  }
})
