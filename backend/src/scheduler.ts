import { Cron } from 'croner'

import { defaultJobLockTimeoutMs, isJobLockExpiry, runWithJobLock } from './db'
import { createBackgroundRuntime, type BackendRuntime } from './runtime'
import { runBackgroundJob, type BackgroundJobName } from './jobs'

export type ScheduleEntry = {
  /** Standard cron expression; croner also accepts a leading seconds field. */
  expression: string
  job: BackgroundJobName
  /** IANA zone. Defaults to UTC so a server's local time cannot shift production schedules. */
  timeZone?: string
  /**
   * How long the job may hold its database lock. Exceeding it releases the lock mid-run and
   * allows a duplicate on another instance, so leave headroom over the slowest expected run.
   */
  timeoutMs?: number
}

/**
 * What this process runs, and the worked example for adding your own.
 *
 * Deploying it is still a choice: a VPS under systemd or Docker, or a cloud worker component. An
 * install that never deploys it queues password-reset emails that nobody sends. See
 * docs/BACKGROUND_JOBS.md, "Running the drain".
 */
export const schedules: ScheduleEntry[] = [
  // Every minute, because the work in the queue is a password-reset email and a link that
  // arrives a quarter of an hour late is a broken reset. `TASK_OUTBOX_MAX_RUNTIME_MS` defaults to
  // 55s precisely so one pass finishes inside one tick, and `protect` below stops a slow pass
  // from overlapping itself. `timeoutMs` is deliberately left at the 15-minute default: an
  // operator may raise the pass budget to ten minutes, and a lock shorter than the run it guards
  // would expire mid-pass and let another instance in.
  { expression: '* * * * *', job: 'outbox:drain' },
  // { expression: '0 3 * * *', job: 'auth:sessions:cleanup' },
]

export type ScheduledJob = { entry: ScheduleEntry; cron: Cron }

export type SchedulerHandle = {
  jobs: ScheduledJob[]
  /** Stops the timers, then resolves once every job already running has finished. */
  stop: () => Promise<void>
}

export function startSchedules(
  runtime: BackendRuntime,
  entries: ScheduleEntry[] = schedules,
): SchedulerHandle {
  // Per-instance rather than module scope, so two schedulers - in a test, or around a reload -
  // cannot end up draining each other's runs.
  const activeRuns = new Set<Promise<void>>()

  const jobs = entries.map((entry) => ({
    entry,
    // Deliberately unnamed: croner keeps a process-wide registry of named jobs and throws on a
    // repeat, which would take the whole scheduler down at startup the moment two entries share
    // a job - a weekday/weekend split, or the same job in two timezones.
    cron: new Cron(
      entry.expression,
      // `protect` stops a run from overlapping itself in this process; the database lock inside
      // `runScheduledJob` stops a second process from doing the same work at the same time.
      { protect: true, timezone: entry.timeZone ?? 'UTC' },
      () => {
        const run = runScheduledJob(runtime, entry)
        activeRuns.add(run)
        return run.finally(() => activeRuns.delete(run))
      },
    ),
  }))

  return {
    jobs,
    stop: async () => {
      // Timers first so nothing new starts, then let running jobs land. Cutting a job off here
      // would leave it half-done with no success or failure recorded anywhere.
      for (const { cron } of jobs) cron.stop()
      await Promise.all([...activeRuns])
    },
  }
}

export async function runScheduledJob(runtime: BackendRuntime, entry: ScheduleEntry) {
  try {
    const outcome = await runWithJobLock(
      runtime.prisma,
      entry.job,
      () => runBackgroundJob(entry.job, runtime),
      { timeoutMs: entry.timeoutMs ?? defaultJobLockTimeoutMs },
    )

    if (!outcome.ranHere) {
      console.log(`Scheduler skipped ${entry.job}: its lock is held elsewhere.`)
    }
  } catch (error) {
    // One failing job must not take the scheduler down; the next tick tries again.
    if (isJobLockExpiry(error)) {
      console.error(
        `${error.message} Another instance may have started it too. Raise timeoutMs for this ` +
          'entry or make the job idempotent.',
        error.cause,
      )
      return
    }

    console.error(`Scheduler job ${entry.job} failed.`, error)
  }
}

export async function main() {
  const runtime = createBackgroundRuntime()
  const { jobs, stop: stopSchedules } = startSchedules(runtime)

  if (jobs.length === 0) {
    // Only reachable once a project empties `schedules`, which is a legitimate thing to do.
    // Nothing to wait for, so do not linger as a process that a supervisor will restart forever.
    console.log(
      'Scheduler started with no schedules. Add entries to `schedules` in src/scheduler.ts; see docs/BACKGROUND_JOBS.md.',
    )
    await runtime.close()
    return
  }

  for (const { entry, cron } of jobs) {
    console.log(
      `Scheduler registered ${entry.job} (${entry.expression}); next run ${cron.nextRun()?.toISOString() ?? 'never'}.`,
    )
  }

  let stopping = false
  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`Scheduler received ${signal}; stopping after in-flight jobs finish.`)
    await stopSchedules()
    await runtime.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void stop('SIGINT'))
  process.on('SIGTERM', () => void stop('SIGTERM'))
}

if (import.meta.main) {
  await main()
}
