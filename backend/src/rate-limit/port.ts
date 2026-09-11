/**
 * Where a fixed-window rate limiter keeps its counters.
 *
 * One store instance serves one policy - one budget with one meaning, such as "auth writes per
 * client address" - so a key only has to be unique within it. `consume` records one request for
 * `key` in the window that contains `now` and answers with that window's running total and the
 * instant it ends. The middleware in `http/security.ts` compares the total with its budget and
 * writes the headers; the store never learns what the budget is for.
 *
 * Two implementations:
 *   - `memory-store.ts` counts inside the process. The default, and the whole truth while one
 *     API instance serves every request.
 *   - `database-store.ts` counts in PostgreSQL with one upsert per request, so any number of
 *     backend processes see one total. Selected by `RATE_LIMIT_STORE=database`.
 *
 * A store may answer with a count past any budget for a key it refuses to track. The memory
 * store does so when its table is full of keys that are all being limited; over budget is over
 * budget, so the middleware needs no second signal for it.
 */

/** The budgets that exist. A closed set so the `policy` column can only hold code-owned names. */
export type RateLimitPolicy = 'auth' | 'account' | 'admin-users-read'

export type RateLimitConsumption = {
  /** Requests seen for the key in the current window, this one included. */
  count: number
  /** Unix time in milliseconds when the current window ends and the count starts over. */
  resetAt: number
}

export type RateLimitStore = {
  consume(key: string, windowSeconds: number, now: number): Promise<RateLimitConsumption>
}

/**
 * Builds the store for one budget. The middleware calls it with the `max` it enforces, so the
 * memory store's eviction protects exactly the keys the middleware is refusing - there is no
 * second copy of the number to drift. The database store has no use for it.
 */
export type RateLimitStoreFactory = (budget: { max: number }) => RateLimitStore
