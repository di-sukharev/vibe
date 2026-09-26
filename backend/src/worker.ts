import { defaultJobLockTimeoutMs, isJobLockExpiry, runWithJobLock } from './db'
import { createBackgroundRuntime, type BackendRuntime } from './runtime'
import { runBackgroundJob, type BackgroundJobName } from './jobs'

type WorkerSignal = 'SIGINT' | 'SIGTERM'
type WorkerSignalSource = {
  off(signal: WorkerSignal, listener: () => void): unknown
  once(signal: WorkerSignal, listener: () => void): unknown
}

// Bun 1.4 adds a memoryPressure overload to Process that hides the inherited Node signal
// overload during structural assignment. Narrow only at this boundary; the worker itself keeps a
// small injectable contract that its shutdown behavior can test without a real process signal.
const processWorkerSignals = process as unknown as WorkerSignalSource

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

export async function runWorker(runtime: BackendRuntime, options: { signal?: AbortSignal } = {}) {
  if (workerLoops.length === 0) {
    console.log(
      'Worker started with no loops. Add entries to `workerLoops` in src/worker.ts; see docs/BACKGROUND_JOBS.md.',
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

export async function main() {
  const runtime = createBackgroundRuntime()
  const shutdown = listenForWorkerShutdown()

  try {
    await runWorker(runtime, { signal: shutdown.signal })
  } finally {
    shutdown.dispose()
    await runtime.close()
  }
}

if (import.meta.main) {
  await main()
}

export function listenForWorkerShutdown(source: WorkerSignalSource = processWorkerSignals) {
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
