import { PrismaPg } from '@prisma/adapter-pg'

import { Prisma, PrismaClient } from './generated/prisma/client'

export function createPrisma(connectionString: string) {
  const adapter = new PrismaPg({ connectionString: normalizePgConnectionString(connectionString) })
  return new PrismaClient({ adapter })
}

export type DbClient = ReturnType<typeof createPrisma>

// Push admission intentionally holds its per-user fence through the provider
// call. Authority transitions acquire that target fence before their short
// global role-policy section, so this budget always covers the complete send
// fence plus the final revocation work.
export const maximumPushSendFenceTransactionMs = 120_000
export const userAuthorityTransitionTransactionOptions = {
  timeout: maximumPushSendFenceTransactionMs + 15_000,
} as const
export const userAuthenticationSessionTransactionOptions = {
  timeout: userAuthorityTransitionTransactionOptions.timeout + 5_000,
} as const

/** How long a background job may hold its lock before Prisma expires the holding transaction. */
export const defaultJobLockTimeoutMs = 15 * 60 * 1000

/**
 * Runs `job` only if no other process is already running it.
 *
 * `croner` protects a job from overlapping itself inside one process; two copies of the process
 * are two independent protections, which is why the guard lives in the database. The lock is held
 * by the surrounding transaction, so it is released when the job finishes and when the process
 * dies - no stale lock survives a crash.
 *
 * **The lock is only as long as `timeoutMs`.** It is Prisma's interactive-transaction timeout, not
 * a Postgres setting - do not go looking at `statement_timeout`. If the job outruns it, Prisma
 * rolls the transaction back and the lock is released while the job is still working: another
 * process can then start the same job, and this one fails after its side effects have already
 * landed. Give `timeoutMs` real headroom over the slowest run, and make jobs that can approach it
 * idempotent. That failure arrives as `JobLockExpiredError` so callers can say what actually
 * happened instead of logging a generic error.
 *
 * The other cost is an open transaction - and therefore a held connection - for the whole run, on
 * top of the connection the job itself uses.
 */
export async function runWithJobLock<Result>(
  prisma: Pick<DbClient, '$transaction'>,
  jobName: string,
  job: () => Promise<Result>,
  { timeoutMs = defaultJobLockTimeoutMs }: { timeoutMs?: number } = {},
): Promise<{ ranHere: true; result: Result } | { ranHere: false }> {
  // Set when the transaction actually starts. Time spent queueing for a connection is not time
  // holding the lock, so it must not count: on a saturated pool Prisma rejects with the same
  // error code before the transaction exists, and blaming that on the lock would send an
  // operator after a timeout instead of after the pool.
  let lockHeldSince: number | undefined

  try {
    return await prisma.$transaction(
      async (tx) => {
        lockHeldSince = Date.now()

        const [{ acquired }] = await tx.$queryRaw<{ acquired: boolean }[]>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`background-job:${jobName}`}, 0)) AS acquired`,
        )

        if (!acquired) return { ranHere: false as const }

        return { ranHere: true as const, result: await job() }
      },
      { timeout: timeoutMs },
    )
  } catch (error) {
    // P2028 covers every transaction-API failure, so the code alone does not identify an expiry:
    // a job that runs its own nested transaction propagates the same code when that inner one
    // times out. Only the time this transaction was open can tell the two apart.
    if (lockHeldSince !== undefined && isPrismaTransactionFailure(error)) {
      const elapsedMs = Date.now() - lockHeldSince

      if (elapsedMs >= timeoutMs) {
        throw new JobLockExpiredError(jobName, timeoutMs, elapsedMs, error)
      }
    }

    throw error
  }
}

/** A job ran longer than its lock, so the lock was released while the job was still working. */
export class JobLockExpiredError extends Error {
  constructor(
    readonly jobName: string,
    readonly timeoutMs: number,
    readonly elapsedMs: number,
    override readonly cause: unknown,
  ) {
    super(
      `Background job "${jobName}" ran for ${elapsedMs}ms, past its ${timeoutMs}ms lock, so the lock was released while the job was still working.`,
    )
    this.name = 'JobLockExpiredError'
  }
}

export function isJobLockExpiry(error: unknown): error is JobLockExpiredError {
  return error instanceof JobLockExpiredError
}

function isPrismaTransactionFailure(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2028'
  )
}

export function acquireUserRoleMutationLock(
  prisma: Pick<DbClient, '$executeRaw'>,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('user-role-mutations', 0))`,
  )
}

export function acquireUserAuthenticationAuthorityLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  userId: string,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-authority:${userId}`}, 0))`,
  )
}

export function acquirePushTokenUserLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  userId: string,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-tokens:${userId}`}, 0))`,
  )
}

export function acquirePushTokenValueLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  expoPushToken: string,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-token:${expoPushToken}`}, 0))`,
  )
}

export function acquirePushInstallationLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  installationId: string,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-installation:${installationId}`}, 0))`,
  )
}

/**
 * Serialises avatar changes for one user.
 *
 * Requesting an upload, finalizing one, and deleting an avatar all move rows between the
 * `pending` and `ready` states that `@@unique([userId, state])` constrains. Without this lock
 * two concurrent requests race that index and one loses with a constraint error rather than a
 * meaningful outcome; with it they simply queue.
 */
export function acquireUserAvatarMutationLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  userId: string,
) {
  return prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user-avatar:${userId}`}, 0))`,
  )
}

export function normalizePgConnectionString(connectionString: string) {
  const url = new URL(connectionString)
  const sslMode = url.searchParams.get('sslmode')
  const useLibpqCompat = url.searchParams.get('uselibpqcompat')

  if (sslMode === 'require' && useLibpqCompat === null) {
    url.searchParams.set('uselibpqcompat', 'true')
  }

  return url.toString()
}
