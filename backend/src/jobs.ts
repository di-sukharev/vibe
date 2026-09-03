import type { BackendRuntime } from './runtime'

/**
 * The one place a background job is declared.
 *
 * One of three ways to work off the request path, and the one for *recurring* work:
 *   - `background-tasks.ts` defers best-effort work inside a single API request. Losing it on a
 *     restart is acceptable.
 *   - `outbox/` queues durable one-off work in PostgreSQL. Losing it is not acceptable, so it is
 *     retried until it succeeds or gives up.
 *   - this file declares work that happens on a timer, whether or not anyone asked for it.
 *
 * A task type is never scheduled; one job here, `outbox:drain`, runs every type.
 *
 * **Keep every import in this file a type import.** Tooling outside the backend reads this list
 * without a database, and may run before `prisma:generate` has; a runtime import here would drag
 * the Prisma client and the env schema along. Reach for `runtime` inside a job body instead of
 * importing a service at the top.
 *
 * Jobs say what to do; they never say when or where. Three processes run this same registry:
 *   - `cron.ts`      - one-job executor for CLI/system cron or Yandex's HTTP timer adapter
 *   - `scheduler.ts` - a timer inside a long-running process, for a VPS or a cloud worker
 *   - `worker.ts`    - a loop, for work that must run more often than once a minute or in parallel
 *
 * Adding a job here makes it available to all three. See docs/BACKGROUND_JOBS.md.
 */
export type BackgroundJob = (runtime: BackendRuntime, now: Date) => Promise<void>

// A worker-pool of this many in-flight requests, not a fixed batch size: the next delete starts
// the moment a slot frees up rather than waiting out the slowest item in a batch. 10 is a small
// deliberate fraction of the 500-row page - enough that a slow object storage backend is not
// hit with hundreds of requests at once, small enough to leave headroom for whatever else is
// calling the same storage concurrently.
const uploadDeleteConcurrency = 10

// `run` must not throw - the only caller here catches its own errors and returns `null`
// instead, which is what makes an item's failure not take down the rest of the pool.
async function withConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await run(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

export const backgroundJobs = {
  noop: async () => {
    console.log('Job noop completed.')
  },
  'db:ping': async ({ prisma }) => {
    await prisma.$queryRaw`SELECT 1`
    console.log('Job db:ping completed.')
  },
  'auth:sessions:cleanup': async ({ env, prisma }, now) => {
    const dayMs = 24 * 60 * 60 * 1000
    const retentionCutoff = new Date(
      now.getTime() - env.SESSION_RETENTION_DAYS * dayMs,
    )
    const absoluteRetentionCutoff = new Date(
      now.getTime() - (env.SESSION_ABSOLUTE_TTL_DAYS + env.SESSION_RETENTION_DAYS) * dayMs,
    )
    const [sessions, resetTokens] = await Promise.all([
      prisma.authSession.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: retentionCutoff } },
            { revokedAt: { lt: retentionCutoff } },
            { createdAt: { lt: absoluteRetentionCutoff } },
          ],
        },
      }),
      prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
    ])
    console.log(
      `Job auth:sessions:cleanup removed ${sessions.count} stale sessions and ${resetTokens.count} expired password reset tokens.`,
    )
  },
  'uploads:pending:cleanup': async ({ prisma, privateStorage }, now) => {
    // An upload whose signed URL has expired can never be finalized, so its row and any bytes
    // that did land are junk. Objects go first: a row deleted before its object would leave
    // storage holding a file nothing points at and nothing will ever look for again.
    const abandoned = await prisma.userAvatar.findMany({
      where: { state: 'pending', expiresAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } },
      orderBy: { expiresAt: 'asc' },
      take: 500,
    })

    // Only rows whose object is actually gone are deleted. Dropping a row after a failed object
    // delete would strand that object forever: the row is the only record of its key, so nothing
    // would ever look for it again. Keeping the row means the next run simply retries. Deletes
    // are idempotent, so a missing object still counts as removed and cannot block the queue.
    // Bounded, not sequential and not unbounded: up to 500 rows one at a time can eat the job's
    // timeout on a slow storage backend, and 500 at once can look like abuse to it. Each delete
    // catches its own failure, so one slow or failing delete never aborts the ones behind it.
    const deletions = await withConcurrency(abandoned, uploadDeleteConcurrency, async (upload) => {
      try {
        await privateStorage.storage.deleteObject(upload.objectKey)
        return upload.id
      } catch (error) {
        console.error(`Job uploads:pending:cleanup could not delete ${upload.objectKey}:`, error)
        return null
      }
    })
    const deletedIds = deletions.filter((id): id is string => id !== null)

    const rows =
      deletedIds.length > 0
        ? await prisma.userAvatar.deleteMany({ where: { id: { in: deletedIds } } })
        : { count: 0 }

    console.log(
      `Job uploads:pending:cleanup removed ${rows.count} abandoned uploads, and left ${abandoned.length - deletedIds.length} to retry.`,
    )
  },
  'outbox:drain': async (runtime, now) => {
    const { drainOptionsFromEnv, drainTaskOutbox } = await import('./outbox')
    const metrics = await drainTaskOutbox(runtime, {
      ...drainOptionsFromEnv(runtime.env),
      now,
    })

    // One line, because an operator reads these in a log: `backlog` climbing across runs means
    // the drain cannot keep up, and `unhandled` above zero means rows are queued for a task type
    // this deployment has no handler for.
    console.log('Job outbox:drain completed.', metrics)
  },
} satisfies Record<string, BackgroundJob>

export type BackgroundJobName = keyof typeof backgroundJobs

export function backgroundJobNames(): BackgroundJobName[] {
  return Object.keys(backgroundJobs) as BackgroundJobName[]
}

export function isBackgroundJobName(value: string): value is BackgroundJobName {
  // `value in backgroundJobs` would also accept 'constructor', 'toString' and the rest of
  // Object.prototype, and those would then run nothing and exit 0 - a provider timer would
  // report a healthy job every night while doing no work.
  return Object.hasOwn(backgroundJobs, value)
}

export async function runBackgroundJob(
  jobName: string,
  runtime: BackendRuntime,
  now = new Date(),
) {
  if (!isBackgroundJobName(jobName)) {
    throw new Error(
      `Unknown job "${jobName}". Available jobs: ${backgroundJobNames().join(', ')}`,
    )
  }

  await backgroundJobs[jobName](runtime, now)
}
