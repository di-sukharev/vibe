import type { DbClient } from '../db'
import { Prisma } from '../generated/prisma/client'
import type { RateLimitPolicy, RateLimitStore } from './port'

export type RateLimitPrisma = Pick<DbClient, '$queryRaw'>

/**
 * Counts in PostgreSQL, so every backend process that shares the database shares the budget.
 *
 * One statement per request: an upsert on `(policy, key, window_start)` that inserts a window's
 * first hit and increments every later one, returning the new total. Two processes racing on the
 * same first hit serialise on the primary key inside PostgreSQL, so the count is exact without a
 * lock or a transaction of its own.
 *
 * Windows are aligned to the clock - the one containing `now` starts at the previous multiple of
 * `windowSeconds` - because that is the only way peers can name the same bucket without talking
 * to each other first. A client's budget therefore renews at the next boundary rather than
 * `windowSeconds` after its first request, which is what the memory store does; the budget per
 * window is the same either way.
 *
 * A database that cannot be reached fails the request instead of letting it through: the handler
 * behind every limited route needs the same database, so nothing was going to succeed anyway.
 *
 * Rows outlive their window until `auth:sessions:cleanup` deletes the ones past `expires_at`.
 */
export function createDatabaseRateLimitStore(
  prisma: RateLimitPrisma,
  policy: RateLimitPolicy,
): RateLimitStore {
  return {
    consume: async (key, windowSeconds, now) => {
      const windowMs = windowSeconds * 1000
      const windowStart = Math.floor(now / windowMs) * windowMs
      const resetAt = windowStart + windowMs
      const [row] = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
        INSERT INTO "rate_limit_buckets" ("policy", "key", "window_start", "count", "expires_at")
        VALUES (${policy}, ${key}, ${new Date(windowStart)}, 1, ${new Date(resetAt)})
        ON CONFLICT ("policy", "key", "window_start")
        DO UPDATE SET "count" = "rate_limit_buckets"."count" + 1
        RETURNING "count"
      `)

      return { count: row.count, resetAt }
    },
  }
}
