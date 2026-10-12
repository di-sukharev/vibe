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
 * the Prisma client and the env schema along. A job that needs a module imports it inside its own
 * body, which also keeps a module's SDKs out of the runs that do not use them.
 *
 * Jobs say what to do; they never say when or where. Three processes run this same registry:
 *   - `cron.ts`      - one-job executor for CLI/system cron or Yandex's HTTP timer adapter
 *   - `scheduler.ts` - a timer inside a long-running process, for a VPS or a cloud worker
 *   - `worker.ts`    - a loop, for work that must run more often than once a minute or in parallel
 *
 * Adding a job here makes it available to all three. See docs/BACKGROUND_JOBS.md.
 */
export type BackgroundJob = (runtime: BackendRuntime, now: Date) => Promise<void>

type GooglePlayReconcileResult = Awaited<
  ReturnType<Awaited<ReturnType<typeof loadBillingModule>>['reconcileGooglePlayBatch']>
>

export const backgroundJobs = {
  noop: async () => {
    console.log('Job noop completed.')
  },
  'db:ping': async ({ prisma }) => {
    await prisma.$queryRaw`SELECT 1`
    console.log('Job db:ping completed.')
  },
  'notifications:process': async (runtime) => {
    const notifications = await loadNotificationsModule(runtime)
    const outbox = await notifications.processOutbox()
    const receipts = await notifications.checkReceipts()
    console.log('Job notifications:process completed.', { outbox, receipts })
  },
  'billing:google-play:reconcile': async (runtime, now) => {
    if (!runtime.env.BILLING_ENABLED) throw new Error('Billing is disabled')
    const result = await reconcileGooglePlayPurchases(runtime, now)
    console.log('Job billing:google-play:reconcile completed.', result)
    assertGooglePlayReconcileSucceeded(result)
  },
  'auth:sessions:cleanup': async (runtime, now) => {
    const { auth, rateLimitWindowsDeleted } = await cleanupRuntimeAuthState(runtime, now)
    console.log(
      `Job auth:sessions:cleanup removed ${auth.sessionsDeleted} stale sessions, ${auth.passwordResetTokensDeleted} expired password reset tokens and ${rateLimitWindowsDeleted} spent rate-limit windows.`,
    )
  },
  'uploads:pending:cleanup': async ({ prisma, privateStorage }, now) => {
    const { cleanupUploads } = await import('./modules/uploads')
    const result = await cleanupUploads({ db: prisma, storage: privateStorage.storage }, now)
    console.log(
      `Job uploads:pending:cleanup removed ${result.removed} abandoned uploads, and left ${result.leftToRetry} to retry.`,
    )
  },
  'maintenance:process': async (runtime, now) => {
    const { auth: { passwordResetTokensDeleted, sessionsDeleted }, rateLimitWindowsDeleted } =
      await cleanupRuntimeAuthState(runtime, now)
    const terminalNotificationOutboxesRedacted = await (
      await loadNotificationsModule(runtime)
    ).redactTerminalData()
    const googlePlay = runtime.env.BILLING_ENABLED && runtime.env.GOOGLE_PLAY_PACKAGE_NAME
      ? await reconcileGooglePlayPurchases(runtime, now)
      : null
    console.log('Job maintenance:process completed.', {
      authSessionsDeleted: sessionsDeleted,
      googlePlay,
      passwordResetTokensDeleted,
      rateLimitWindowsDeleted,
      terminalNotificationOutboxesRedacted,
    })
    if (googlePlay) assertGooglePlayReconcileSucceeded(googlePlay)
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

async function loadNotificationsModule({ env, prisma }: BackendRuntime) {
  const { createNotificationsModule } = await import('./modules/notifications')
  return createNotificationsModule({ db: prisma, env })
}

async function loadBillingModule({ env, prisma }: BackendRuntime) {
  const { createBillingModule } = await import('./modules/billing')
  return createBillingModule({ db: prisma, env })
}

async function reconcileGooglePlayPurchases(runtime: BackendRuntime, now: Date) {
  const billing = await loadBillingModule(runtime)
  const result = await billing.reconcileGooglePlayBatch({
    before: new Date(now.getTime() - 15 * 60 * 1000),
    deadline: new Date(now.getTime() + 50 * 1000),
    limit: 100,
  })
  return {
    ...result,
    backlogOldestAgeSeconds: result.backlogOldestDueAt
      ? Math.max(
          0,
          Math.floor((now.getTime() - result.backlogOldestDueAt.getTime()) / 1_000),
        )
      : null,
  }
}

function assertGooglePlayReconcileSucceeded(result: GooglePlayReconcileResult) {
  if (result.failed > 0) {
    throw new Error(
      `Google Play reconcile failed for ${result.failed} of ${result.attempted} attempted purchases`,
    )
  }
}

async function cleanupRuntimeAuthState(runtime: BackendRuntime, now: Date) {
  const { cleanupAuthState } = await import('./modules/auth')
  const { cleanupPushRegistrations } = await import('./modules/notifications')
  const { cleanupExpiredRateLimitWindows } = await import('./rate-limit')
  await cleanupPushRegistrations({ db: runtime.prisma, env: runtime.env }, now)
  const [auth, rateLimitWindowsDeleted] = await Promise.all([
    cleanupAuthState(runtime, now), cleanupExpiredRateLimitWindows(runtime.prisma, now),
  ])
  return { auth, rateLimitWindowsDeleted }
}

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
