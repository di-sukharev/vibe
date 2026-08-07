import type { BackendRuntime } from './runtime'

/**
 * The one place a background job is declared.
 *
 * Jobs, not tasks: `background-tasks.ts` next door is a different mechanism - it defers
 * best-effort work inside a single API request. These run outside any request.
 *
 * **Keep every import in this file a type import.** Tooling outside the backend reads this list
 * without a database, and may run before `prisma:generate` has; a runtime import here would drag
 * the Prisma client and the env schema along. A job that needs a module imports it inside its own
 * body, which also keeps a module's SDKs out of the runs that do not use them.
 * `scripts/repo-env.test.mjs` enforces this.
 *
 * Jobs say what to do; they never say when or where. Three processes run this same registry:
 *   - `cron.ts`      - one shot, triggered by a provider timer (DigitalOcean job, Yandex trigger, system cron)
 *   - `scheduler.ts` - a timer inside a long-running process, for a VPS or a cloud worker
 *   - `worker.ts`    - a loop, for work that must run more often than once a minute or in parallel
 *
 * Adding a job here makes it available to all three. See docs/BACKGROUND_JOBS.md.
 */
export type BackgroundJob = (runtime: BackendRuntime, now: Date) => Promise<void>

// Uncomment with the billing job below (docs/IAP.md). Import it inside the job body, never at the
// top of this file: a top-level import pulls the Apple and Google SDKs into every background run.
//
// type GooglePlayReconcileResult = Awaited<
//   ReturnType<Awaited<ReturnType<typeof loadBillingModule>>['reconcileGooglePlayBatch']>
// >

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
  // Uncomment together with the billing module (docs/IAP.md):
  // 'billing:google-play:reconcile': async (runtime, now) => {
  //   const result = await reconcileGooglePlayPurchases(runtime, now)
  //   console.log('Job billing:google-play:reconcile completed.', result)
  //   assertGooglePlayReconcileSucceeded(result)
  // },
  'auth:sessions:cleanup': async (runtime, now) => {
    const { passwordResetTokensDeleted, sessionsDeleted } = await cleanupAuthState(runtime, now)
    console.log(
      `Job auth:sessions:cleanup removed ${sessionsDeleted} stale sessions and ${passwordResetTokensDeleted} expired password reset tokens.`,
    )
  },
  'maintenance:process': async (runtime, now) => {
    const { passwordResetTokensDeleted, sessionsDeleted } = await cleanupAuthState(runtime, now)
    const terminalNotificationOutboxesRedacted = await (
      await loadNotificationsModule(runtime)
    ).redactTerminalData()
    // Uncomment together with the billing module so maintenance also reconciles Google Play:
    // const googlePlay = runtime.env.GOOGLE_PLAY_PACKAGE_NAME
    //   ? await reconcileGooglePlayPurchases(runtime, now)
    //   : null
    console.log('Job maintenance:process completed.', {
      authSessionsDeleted: sessionsDeleted,
      // googlePlay,
      passwordResetTokensDeleted,
      terminalNotificationOutboxesRedacted,
    })
    // if (googlePlay) assertGooglePlayReconcileSucceeded(googlePlay)
  },
} satisfies Record<string, BackgroundJob>

async function loadNotificationsModule({ env, prisma }: BackendRuntime) {
  const { createNotificationsModule } = await import('./modules/notifications')
  return createNotificationsModule({ db: prisma, env })
}

// async function loadBillingModule({ env, prisma }: BackendRuntime) {
//   const { createBillingModule } = await import('./modules/billing')
//   return createBillingModule({ db: prisma, env })
// }
//
// async function reconcileGooglePlayPurchases(runtime: BackendRuntime, now: Date) {
//   const billing = await loadBillingModule(runtime)
//   const result = await billing.reconcileGooglePlayBatch({
//     before: new Date(now.getTime() - 15 * 60 * 1000),
//     deadline: new Date(now.getTime() + 50 * 1000),
//     limit: 100,
//   })
//   return {
//     ...result,
//     backlogOldestAgeSeconds: result.backlogOldestDueAt
//       ? Math.max(
//           0,
//           Math.floor((now.getTime() - result.backlogOldestDueAt.getTime()) / 1_000),
//         )
//       : null,
//   }
// }
//
// function assertGooglePlayReconcileSucceeded(result: GooglePlayReconcileResult) {
//   if (result.failed > 0) {
//     throw new Error(
//       `Google Play reconcile failed for ${result.failed} of ${result.attempted} attempted purchases`,
//     )
//   }
// }

async function cleanupAuthState({ env, prisma }: BackendRuntime, now: Date) {
  const dayMs = 24 * 60 * 60 * 1000
  const retentionCutoff = new Date(
    now.getTime() - env.SESSION_RETENTION_DAYS * dayMs,
  )
  const absoluteRetentionCutoff = new Date(
    now.getTime() - (env.SESSION_ABSOLUTE_TTL_DAYS + env.SESSION_RETENTION_DAYS) * dayMs,
  )
  const absoluteSessionNotBefore = new Date(
    now.getTime() - env.SESSION_ABSOLUTE_TTL_DAYS * dayMs,
  )
  await prisma.$executeRaw`
    UPDATE "push_tokens" AS token
    SET "registration_session_id" = (
      SELECT session."id"
      FROM "auth_sessions" AS session
      WHERE session."user_id" = token."user_id"
        AND session."revoked_at" IS NULL
        AND session."expires_at" > ${now}
        AND session."created_at" > ${absoluteSessionNotBefore}
      ORDER BY session."created_at" DESC, session."id" DESC
      LIMIT 1
    )
    WHERE token."installation_id" IS NULL
      AND token."registration_session_id" IS NULL
  `
  await prisma.$executeRaw`
    DELETE FROM "push_tokens" AS token
    WHERE token."registration_session_id" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "auth_sessions" AS session
        WHERE session."id" = token."registration_session_id"
          AND session."user_id" = token."user_id"
          AND session."revoked_at" IS NULL
          AND session."expires_at" > ${now}
          AND session."created_at" > ${absoluteSessionNotBefore}
      )
  `
  const [sessions, passwordResetTokens] = await Promise.all([
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
  return {
    passwordResetTokensDeleted: passwordResetTokens.count,
    sessionsDeleted: sessions.count,
  }
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
