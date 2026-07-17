import { createBackgroundRuntime, type BackendRuntime } from './runtime'
import { createBillingModule } from './modules/billing'
import { createNotificationsModule } from './modules/notifications'

type CronTask = (runtime: BackendRuntime, now: Date) => Promise<void>

type GooglePlayReconcileResult = Awaited<
  ReturnType<ReturnType<typeof createBillingModule>['reconcileGooglePlayBatch']>
>

const cronTasks = {
  noop: async () => {
    console.log('Cron noop task completed.')
  },
  'db:ping': async ({ prisma }) => {
    await prisma.$queryRaw`SELECT 1`
    console.log('Cron db:ping task completed.')
  },
  'notifications:process': async (runtime) => {
    const notifications = createNotificationsModule({
      db: runtime.prisma,
      env: runtime.env,
    })
    const outbox = await notifications.processOutbox()
    const receipts = await notifications.checkReceipts()
    console.log('Cron notifications:process task completed.', {
      outbox,
      receipts,
    })
  },
  'billing:google-play:reconcile': async (runtime, now) => {
    const result = await reconcileGooglePlayPurchases(runtime, now)
    console.log('Cron billing:google-play:reconcile task completed.', result)
    assertGooglePlayReconcileSucceeded(result)
  },
  'auth:sessions:cleanup': async (runtime, now) => {
    const count = await cleanupAuthSessions(runtime, now)
    console.log(`Cron auth:sessions:cleanup removed ${count} stale sessions.`)
  },
  'maintenance:process': async (runtime, now) => {
    const authSessionsDeleted = await cleanupAuthSessions(runtime, now)
    const terminalNotificationOutboxesRedacted = await createNotificationsModule({
      db: runtime.prisma,
      env: runtime.env,
    }).redactTerminalData()
    const googlePlay = runtime.env.GOOGLE_PLAY_PACKAGE_NAME
      ? await reconcileGooglePlayPurchases(runtime, now)
      : null
    console.log('Cron maintenance:process task completed.', {
      authSessionsDeleted,
      googlePlay,
      terminalNotificationOutboxesRedacted,
    })
    if (googlePlay) assertGooglePlayReconcileSucceeded(googlePlay)
  },
} satisfies Record<string, CronTask>

async function cleanupAuthSessions({ env, prisma }: BackendRuntime, now: Date) {
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
  const { count } = await prisma.authSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: retentionCutoff } },
        { revokedAt: { lt: retentionCutoff } },
        { createdAt: { lt: absoluteRetentionCutoff } },
      ],
    },
  })
  return count
}

async function reconcileGooglePlayPurchases(runtime: BackendRuntime, now: Date) {
  const billing = createBillingModule({
    db: runtime.prisma,
    env: runtime.env,
  })
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
          Math.floor(
            (now.getTime() - result.backlogOldestDueAt.getTime()) / 1_000,
          ),
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

export type CronTaskName = keyof typeof cronTasks

export async function runCronTask(
  taskName: string,
  runtime: BackendRuntime,
  now = new Date(),
) {
  const task = cronTasks[taskName as CronTaskName]

  if (!task) {
    throw new Error(`Unknown cron task "${taskName}". Available tasks: ${Object.keys(cronTasks).join(', ')}`)
  }

  await task(runtime, now)
}

export async function main(argv: string[] = Bun.argv.slice(2)) {
  const [taskName] = argv

  if (!taskName) {
    console.error(`Cron task name is required. Available tasks: ${Object.keys(cronTasks).join(', ')}`)
    process.exit(1)
  }

  const runtime = createBackgroundRuntime()

  try {
    await runCronTask(taskName, runtime)
  } finally {
    await runtime.close()
  }
}

if (import.meta.main) {
  await main()
}
