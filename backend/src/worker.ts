import { defaultJobLockTimeoutMs, isJobLockExpiry, runWithJobLock } from './db'
import { createBackgroundRuntime, type BackendRuntime } from './runtime'
import { runBackgroundJob, type BackgroundJobName } from './jobs'
import type { createNotificationsModule } from './modules/notifications'

/**
 * The loop-shaped runner, in two flavours.
 *
 * `bun src/worker.ts` runs whatever is configured in `workerLoops` below: generic loops over the
 * job registry in `jobs.ts`, shared with `cron.ts` and `scheduler.ts`. Empty by default.
 *
 * `bun src/worker.ts notifications` runs the purpose-built push pipeline instead. It is not a
 * `workerLoop` because it needs more than an interval: outbox processing is handed the shutdown
 * `AbortSignal` and a runtime budget derived from `SHUTDOWN_GRACE_SECONDS`, so a long batch is cut
 * short cleanly rather than killed mid-send, and quiet periods still emit a heartbeat.
 *
 * See docs/BACKGROUND_JOBS.md.
 */
type WorkerMode = 'notifications' | 'loops'
type WorkerSignal = 'SIGINT' | 'SIGTERM'
type WorkerSignalSource = {
  off(signal: WorkerSignal, listener: () => void): unknown
  once(signal: WorkerSignal, listener: () => void): unknown
}

type WorkerLogger = Pick<Console, 'error' | 'log'>

const defaultWorkerHeartbeatIntervalMs = 5 * 60 * 1_000

export type WorkerLoop = {
  job: BackgroundJobName
  /** Pause between iterations. Use this process when a minute between runs is too long. */
  intervalMs: number
  /**
   * Take the same database lock the scheduler uses, so scaling the worker to several instances
   * does not run this job twice. Off by default: most loop work is either idempotent or
   * deliberately parallel, and the lock costs an open transaction per iteration.
   */
  singleInstance?: boolean
  /**
   * How long a `singleInstance` iteration may hold that lock. Exceeding it releases the lock
   * mid-run and allows a duplicate on another instance, so leave headroom over the slowest
   * expected iteration. Ignored when `singleInstance` is off.
   */
  timeoutMs?: number
}

/**
 * Empty on purpose, like the scheduler.
 *
 * The worker runs the same jobs as `cron.ts` and `scheduler.ts` - only the process shape differs.
 * A cron is a timer: it fires on a schedule, and no cron expression goes below one minute. A
 * worker is a loop: use it when work must run more often than that, must run continuously, or
 * when several jobs should run side by side. Loops listed here run in parallel with each other.
 *
 * See docs/BACKGROUND_JOBS.md before switching this on.
 */
export const workerLoops: WorkerLoop[] = [
  // { job: 'db:ping', intervalMs: 10_000 },
]

export type WorkerHandle = {
  /** Resolves once every loop has finished the iteration it was in. */
  stopped: Promise<void>
  stop: () => void
}

export function startWorkerLoops(
  runtime: BackendRuntime,
  loops: WorkerLoop[] = workerLoops,
): WorkerHandle {
  let running = true
  // One waker per sleeping loop. A single shared waker would only interrupt whichever loop
  // happened to fall asleep last, so a stop signal could hang for a full interval.
  const wakers = new Set<() => void>()

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(finish, ms)
      const waker = finish
      wakers.add(waker)

      function finish() {
        clearTimeout(timer)
        wakers.delete(waker)
        resolve()
      }
    })

  async function runLoop(loop: WorkerLoop) {
    while (running) {
      try {
        await runIteration(runtime, loop)
      } catch (error) {
        // A failing iteration must not kill the loop; the next one tries again after the
        // usual pause.
        reportIterationFailure(loop, error)
      }

      if (!running) break
      await sleep(loop.intervalMs)
    }
  }

  const stopped = Promise.all(loops.map(runLoop)).then(() => undefined)

  return {
    stopped,
    stop: () => {
      running = false
      for (const wake of [...wakers]) wake()
    },
  }
}

async function runIteration(runtime: BackendRuntime, loop: WorkerLoop) {
  if (!loop.singleInstance) {
    await runBackgroundJob(loop.job, runtime)
    return
  }

  const outcome = await runWithJobLock(
    runtime.prisma,
    loop.job,
    () => runBackgroundJob(loop.job, runtime),
    { timeoutMs: loop.timeoutMs ?? defaultJobLockTimeoutMs },
  )

  if (!outcome.ranHere) {
    console.log(`Worker skipped ${loop.job}: its lock is held elsewhere.`)
  }
}

function reportIterationFailure(loop: WorkerLoop, error: unknown) {
  if (isJobLockExpiry(error)) {
    console.error(
      `${error.message} Another instance may have started it too. Raise timeoutMs for this loop ` +
        'or make the job idempotent.',
      error.cause,
    )
    return
  }

  console.error(`Worker job ${loop.job} failed.`, error)
}
export async function runNotificationsWorker(
  runtime: BackendRuntime,
  options: {
    heartbeatIntervalMs?: number
    logger?: WorkerLogger
    notifications?: Pick<
      ReturnType<typeof createNotificationsModule>,
      'checkReceipts' | 'processOutbox'
    >
    now?: () => number
    pollIntervalMs?: number
    signal?: AbortSignal
  } = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? defaultWorkerHeartbeatIntervalMs
  const logger = options.logger ?? console
  const now = options.now ?? Date.now
  const notifications =
    options.notifications ??
    // Imported here rather than at the top of the file: the loop runners in this same module are
    // read by tooling that must not pull the Expo SDK in.
    (await import('./modules/notifications')).createNotificationsModule({
      db: runtime.prisma,
      env: runtime.env,
    })
  const shutdownBudgetMs = Math.max(1, runtime.env.SHUTDOWN_GRACE_SECONDS * 1_000 - 5_000)
  const processMaxRuntimeMs = Math.min(
    runtime.env.PUSH_OUTBOX_PROCESS_MAX_RUNTIME_MS ?? shutdownBudgetMs,
    shutdownBudgetMs,
  )
  let lastHeartbeatAt = now()
  logger.log(`Notification worker started; polling every ${pollIntervalMs}ms.`)

  while (!options.signal?.aborted) {
    const outbox = await notifications
      .processOutbox({ maxRuntimeMs: processMaxRuntimeMs, signal: options.signal })
      .catch((error: unknown) => {
        if (!options.signal?.aborted) {
          logger.error('[NotificationWorker] processPushOutbox failed:', error)
        }
        return null
      })
    if (options.signal?.aborted) break

    const receipts = await notifications
      .checkReceipts({ signal: options.signal })
      .catch((error: unknown) => {
        if (!options.signal?.aborted) {
          logger.error('[NotificationWorker] checkPushReceipts failed:', error)
        }
        return null
      })

    if (options.signal?.aborted) break

    const currentTime = now()
    if (hasNotificationActivity(outbox, receipts)) {
      logger.log('[NotificationWorker] activity', { outbox, receipts })
      lastHeartbeatAt = currentTime
    } else {
      if (currentTime - lastHeartbeatAt >= heartbeatIntervalMs) {
        logger.log('[NotificationWorker] heartbeat')
        lastHeartbeatAt = currentTime
      }
    }

    await delay(pollIntervalMs, options.signal)
  }
}

export async function runWorker(
  runtime: BackendRuntime,
  mode: WorkerMode = 'loops',
  options: { signal?: AbortSignal } = {},
) {
  if (mode === 'notifications') {
    await runNotificationsWorker(runtime, options)
    return
  }

  if (workerLoops.length === 0) {
    console.log(
      'Worker started with no loops. Add entries to `workerLoops` in src/worker.ts, or run `bun src/worker.ts notifications`; see docs/BACKGROUND_JOBS.md.',
    )
    return
  }

  const handle = startWorkerLoops(runtime)
  const stopOnAbort = () => handle.stop()
  options.signal?.addEventListener('abort', stopOnAbort, { once: true })

  try {
    await handle.stopped
  } finally {
    options.signal?.removeEventListener('abort', stopOnAbort)
  }
}

export async function main(argv: string[] = Bun.argv.slice(2)) {
  const runtime = createBackgroundRuntime()
  const mode: WorkerMode = argv[0] === 'notifications' ? 'notifications' : 'loops'
  const shutdown = listenForWorkerShutdown()

  try {
    await runWorker(runtime, mode, { signal: shutdown.signal })
  } finally {
    shutdown.dispose()
    await runtime.close()
  }
}

if (import.meta.main) {
  await main()
}

export function listenForWorkerShutdown(source: WorkerSignalSource = process) {
  const controller = new AbortController()
  const abort = () => controller.abort()

  source.once('SIGINT', abort)
  source.once('SIGTERM', abort)

  return {
    signal: controller.signal,
    dispose() {
      source.off('SIGINT', abort)
      source.off('SIGTERM', abort)
    },
  }
}

function delay(ms: number, signal: AbortSignal | undefined) {
  if (signal?.aborted) return Promise.resolve()

  return new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>
    const finish = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    timeout = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

function hasNotificationActivity(
  outbox: Awaited<ReturnType<ReturnType<typeof createNotificationsModule>['processOutbox']>> | null,
  receipts: Awaited<ReturnType<ReturnType<typeof createNotificationsModule>['checkReceipts']>> | null,
) {
  return (
    (outbox != null && Object.values(outbox).some((value) => value > 0)) ||
    (receipts != null && Object.values(receipts).some((value) => value > 0))
  )
}
