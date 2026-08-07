import { afterAll, describe, expect, test } from 'bun:test'

import { createPrisma, isJobLockExpiry, runWithJobLock, type DbClient } from './db'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

/**
 * The scheduler's only defence against two instances running the same job is this lock, and its
 * behaviour lives entirely in Postgres. Faking `$transaction` proves nothing here: a session-scoped
 * `pg_try_advisory_lock` instead of the transaction-scoped one would pass a mocked test and leak
 * locks across pooled connections in production.
 */
maybeDescribe('runWithJobLock against a real database', () => {
  const clients: DbClient[] = []

  const newClient = () => {
    const client = createPrisma(databaseUrl!)
    clients.push(client)
    return client
  }

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()))
  })

  test('only one of two concurrent processes runs the job', async () => {
    const first = newClient()
    const second = newClient()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let runs = 0

    const holder = runWithJobLock(first, 'test:contended', async () => {
      runs += 1
      started.resolve()
      await release.promise
    })

    // Only contend once the lock is genuinely held; otherwise the second call could win the race
    // and the test would pass for the wrong reason.
    await started.promise
    const contender = await runWithJobLock(second, 'test:contended', async () => {
      runs += 1
    })

    release.resolve()

    expect(contender).toEqual({ ranHere: false })
    expect(await holder).toEqual({ ranHere: true, result: undefined })
    expect(runs).toBe(1)
  })

  test('different jobs do not block each other', async () => {
    const first = newClient()
    const second = newClient()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()

    const holder = runWithJobLock(first, 'test:one', async () => {
      started.resolve()
      await release.promise
    })

    await started.promise
    const other = await runWithJobLock(second, 'test:two', async () => 'ran')
    release.resolve()
    await holder

    expect(other).toEqual({ ranHere: true, result: 'ran' })
  })

  test('a job that outruns its timeout loses the lock and reports it as a lock expiry', async () => {
    const first = newClient()
    const second = newClient()
    let overrunFinished = false

    const overrun = runWithJobLock(
      first,
      'test:overrun',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 400))
        overrunFinished = true
      },
      { timeoutMs: 150 },
    ).catch((error: unknown) => error)

    // Wait past the timeout: the lock is gone even though the job body is still running, which is
    // exactly the duplicate-run window the scheduler warns about.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const duplicate = await runWithJobLock(second, 'test:overrun', async () => 'ran anyway')

    const failure = await overrun

    expect(duplicate).toEqual({ ranHere: true, result: 'ran anyway' })
    expect(overrunFinished).toBe(true)
    expect(isJobLockExpiry(failure)).toBe(true)
    expect(String(failure)).toContain('past its 150ms lock')
  })

  test("a job's own inner transaction timing out is not reported as a lock expiry", async () => {
    // Prisma answers P2028 for every transaction-API failure, so keying on the code alone told
    // the operator to raise a lock timeout that was never involved. The lock here has 15 minutes
    // of headroom; the inner transaction is the thing that expired.
    const client = newClient()

    const failure = await runWithJobLock(client, 'test:nested', async () => {
      await client.$transaction(
        async () => {
          // Slow work inside the job's own transaction, not a slow query: the transaction is
          // still open when Prisma expires it, and the commit is what raises P2028.
          await Bun.sleep(300)
        },
        { timeout: 100 },
      )
    }).catch((error: unknown) => error)

    expect((failure as { code?: string }).code).toBe('P2028')
    expect(isJobLockExpiry(failure)).toBe(false)
  })

  test('the same client can run the same job again afterwards', async () => {
    // A scheduler ticks the same job over and over on one client; every tick must run.
    const client = newClient()

    expect(await runWithJobLock(client, 'test:repeat', async () => 'first')).toEqual({
      ranHere: true,
      result: 'first',
    })
    expect(await runWithJobLock(client, 'test:repeat', async () => 'second')).toEqual({
      ranHere: true,
      result: 'second',
    })
  })

  test('the lock is released when the job throws', async () => {
    const first = newClient()
    const second = newClient()

    await expect(
      runWithJobLock(first, 'test:throwing', async () => {
        throw new Error('job exploded')
      }),
    ).rejects.toThrow('job exploded')

    expect(await runWithJobLock(second, 'test:throwing', async () => 'ran')).toEqual({
      ranHere: true,
      result: 'ran',
    })
  })
})
