import { expect, spyOn, test } from 'bun:test'

import { Cron } from 'croner'

import { runScheduledJob, schedules, startSchedules, type ScheduleEntry } from './scheduler'
import type { BackendRuntime } from './runtime'

function runtimeWithLock(options: { acquired: boolean }) {
  const calls = { transactions: 0 }

  const prisma = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      calls.transactions += 1
      return run({
        $queryRaw: async () => [{ acquired: options.acquired }],
      })
    },
    $queryRaw: async () => [{ '?column?': 1 }],
  }

  return { calls, runtime: { prisma } as unknown as BackendRuntime }
}

const pingEntry: ScheduleEntry = { expression: '* * * * *', job: 'db:ping' }

test('a scheduled job runs when this process wins the lock', async () => {
  const { calls, runtime } = runtimeWithLock({ acquired: true })
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    await runScheduledJob(runtime, pingEntry)

    expect(calls.transactions).toBe(1)
    expect(log).toHaveBeenCalledWith('Job db:ping completed.')
  } finally {
    log.mockRestore()
  }
})

test('a scheduled job is skipped while another process holds the lock', async () => {
  // Two copies of the scheduler are normal during a rolling deploy; the second must do nothing
  // rather than run the same job twice.
  const { runtime } = runtimeWithLock({ acquired: false })
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    await runScheduledJob(runtime, pingEntry)

    expect(log).toHaveBeenCalledWith('Scheduler skipped db:ping: its lock is held elsewhere.')
    expect(log).not.toHaveBeenCalledWith('Job db:ping completed.')
  } finally {
    log.mockRestore()
  }
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
  const { runtime } = runtimeWithLock({ acquired: true })
  const { jobs } = startSchedules(runtime, [
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

test('a job that outran its lock is reported as a duplicate-run risk, not a generic failure', async () => {
  // Prisma expires the holding transaction after the lock is already gone, so the operator has to
  // be told that another instance may have started the same job.
  const runtime = {
    prisma: {
      // The transaction starts and the job runs; the commit is what fails, after the budget.
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        await run({ $queryRaw: async () => [{ acquired: true }] })
        await Bun.sleep(30)
        throw Object.assign(new Error('transaction expired'), { code: 'P2028' })
      },
      $queryRaw: async () => [{ '?column?': 1 }],
    },
  } as unknown as BackendRuntime
  const error = spyOn(console, 'error').mockImplementation(() => {})
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    await runScheduledJob(runtime, { ...pingEntry, timeoutMs: 10 })

    expect(String(error.mock.calls[0]?.[0])).toContain('past its 10ms lock')
    expect(String(error.mock.calls[0]?.[0])).toContain('Another instance may have started it too')
  } finally {
    error.mockRestore()
    log.mockRestore()
  }
})

test('a transaction failure inside a job is not blamed on the lock', async () => {
  // The same P2028 arrives when the job runs its own nested transaction and that one times out.
  // Telling the operator to raise the lock timeout would send them after the wrong thing.
  const runtime = {
    prisma: {
      $transaction: async () => {
        throw Object.assign(new Error('inner transaction expired'), { code: 'P2028' })
      },
    },
  } as unknown as BackendRuntime
  const error = spyOn(console, 'error').mockImplementation(() => {})

  try {
    await runScheduledJob(runtime, { ...pingEntry, timeoutMs: 60_000 })

    expect(String(error.mock.calls[0]?.[0])).toBe('Scheduler job db:ping failed.')
  } finally {
    error.mockRestore()
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
    // Every second, so the tick lands inside the test rather than at the top of a minute.
    const handle = startSchedules(runtime, [{ expression: '* * * * * *', job: 'db:ping' }])
    await Bun.sleep(1_100)

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
  const { runtime } = runtimeWithLock({ acquired: true })

  const handle = startSchedules(runtime, [
    { expression: '0 9 * * 1-5', job: 'auth:sessions:cleanup' },
    { expression: '0 12 * * 6,0', job: 'auth:sessions:cleanup' },
  ])

  try {
    expect(handle.jobs.map((job) => job.cron.nextRun()?.getTime())).not.toContain(undefined)
    expect(handle.jobs).toHaveLength(2)
  } finally {
    void handle.stop()
  }
})

test('the shipped schedule drains the outbox often enough for a password-reset email', () => {
  // The one entry the template ships, asserted against the real cron library rather than the
  // string: a change to '*/30 * * * *' would still look fine but would make a reset link arrive
  // half an hour late, which docs/EMAIL.md promises it does not.
  const drain = schedules.find((entry) => entry.job === 'outbox:drain')

  expect(drain).toBeDefined()

  const [first, second] = new Cron(drain!.expression, {
    timezone: drain!.timeZone ?? 'UTC',
  }).nextRuns(2)

  // One minute, which is what docs/EMAIL.md and CHECKLIST.md promise. Deliberately not the
  // 15-minute DigitalOcean floor: `*/15 * * * *` is the realistic regression, and it would make
  // both of those documents false while still looking like a reasonable schedule.
  expect(second!.getTime() - first!.getTime()).toBeLessThanOrEqual(60 * 1000)
})
