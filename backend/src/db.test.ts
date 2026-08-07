import { describe, expect, test } from 'bun:test'

import { isJobLockExpiry, runWithJobLock, type DbClient } from './db'
import { normalizePgConnectionString } from './db'

describe('normalizePgConnectionString', () => {
  test('adds libpq compatibility for DigitalOcean sslmode=require URLs', () => {
    const result = normalizePgConnectionString(
      'postgresql://user:pass@db.example.com:25060/defaultdb?sslmode=require',
    )

    expect(result).toBe(
      'postgresql://user:pass@db.example.com:25060/defaultdb?sslmode=require&uselibpqcompat=true',
    )
  })

  test('preserves explicit libpq compatibility choice', () => {
    const result = normalizePgConnectionString(
      'postgresql://user:pass@db.example.com:25060/defaultdb?sslmode=require&uselibpqcompat=false',
    )

    expect(result).toBe(
      'postgresql://user:pass@db.example.com:25060/defaultdb?sslmode=require&uselibpqcompat=false',
    )
  })

  test('does not change non-TLS local URLs', () => {
    const result = normalizePgConnectionString(
      'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public',
    )

    expect(result).toBe('postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public')
  })
})

describe('runWithJobLock failure classification', () => {
  const failingTransaction = (
    behaviour: (start: () => void) => Promise<never>,
  ): Pick<DbClient, '$transaction'> =>
    ({
      $transaction: (run: (tx: unknown) => Promise<unknown>) =>
        behaviour(() => void run({ $queryRaw: async () => [{ acquired: true }] })),
    }) as unknown as Pick<DbClient, '$transaction'>

  test('a transaction that never started is not a lock expiry, however long it waited', async () => {
    // Prisma answers the same P2028 when the connection pool is saturated: it gives up before the
    // transaction, and therefore before the lock, exists. Counting that wait as lock time told the
    // operator to raise a timeout and warned about a duplicate run that could not have happened.
    const prisma = failingTransaction(async () => {
      await Bun.sleep(30)
      throw Object.assign(new Error('Unable to start a transaction in the given time.'), {
        code: 'P2028',
      })
    })

    const failure = await runWithJobLock(prisma, 'job', async () => 'never', {
      timeoutMs: 10,
    }).catch((error: unknown) => error)

    expect(isJobLockExpiry(failure)).toBe(false)
  })

  test("a transaction that failed well inside its budget is the job's own problem", async () => {
    // The job ran its own nested transaction and that one expired: same error code, but this
    // lock had minutes left, so nothing was released early and no duplicate is possible.
    const prisma = failingTransaction(async (start) => {
      start()
      throw Object.assign(new Error('inner transaction expired'), { code: 'P2028' })
    })

    const failure = await runWithJobLock(prisma, 'job', async () => 'ran', {
      timeoutMs: 60_000,
    }).catch((error: unknown) => error)

    expect(isJobLockExpiry(failure)).toBe(false)
  })

  test('a transaction that started and outran the timeout is a lock expiry', async () => {
    const prisma = failingTransaction(async (start) => {
      start()
      await Bun.sleep(30)
      throw Object.assign(new Error('transaction expired'), { code: 'P2028' })
    })

    const failure = await runWithJobLock(prisma, 'job', async () => 'ran', {
      timeoutMs: 10,
    }).catch((error: unknown) => error)

    expect(isJobLockExpiry(failure)).toBe(true)
  })
})
