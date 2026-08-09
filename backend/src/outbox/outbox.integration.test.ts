import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../db'
import type { BackendRuntime } from '../runtime'
import { drainTaskOutbox } from './drain'
import type { TaskHandlerRegistry } from './handlers'
import { enqueueTask } from './index'
import { claimTask, completeTask } from './store'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

/**
 * The claim is the whole safety argument of this module, and it is made of database semantics a
 * fake client cannot have: two concurrent `UPDATE ... WHERE status = 'pending'` statements
 * serialising on a row lock. Everything here needs a real PostgreSQL.
 */
maybeDescribe('the task outbox against a real database', () => {
  const prisma = createPrisma(databaseUrl!)
  const runtime = { prisma } as unknown as BackendRuntime
  const now = () => new Date()

  beforeEach(async () => {
    await prisma.taskOutbox.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const registry = (run: () => Promise<void>): TaskHandlerRegistry => ({ 'test:work': { run } })

  test('two drains running at once split the work instead of duplicating it', async () => {
    // The test that would have caught it if dropping the advisory lock were wrong.
    const seeded = 40
    const idle = registry(async () => undefined)
    for (let index = 0; index < seeded; index += 1) {
      const key = `concurrent-${index}`
      await enqueueTask(prisma, { type: 'test:work', dedupeKey: key, payload: { key } }, idle)
    }

    const ran: string[] = []
    const handlers: TaskHandlerRegistry = {
      'test:work': {
        run: async ({ payload }) => {
          ran.push((payload as { key: string }).key)
          // Long enough that the two passes genuinely overlap.
          await Bun.sleep(2)
        },
      },
    }

    const [left, right] = await Promise.all([
      drainTaskOutbox(runtime, { handlers, now: now() }),
      drainTaskOutbox(runtime, { handlers, now: now() }),
    ])

    expect(left.done + right.done).toBe(seeded)
    expect(ran).toHaveLength(seeded)
    expect(new Set(ran).size).toBe(seeded)
    expect(await prisma.taskOutbox.count({ where: { status: 'done' } })).toBe(seeded)
  })

  test('enqueueing the same work twice yields one row', async () => {
    const handlers = registry(async () => undefined)
    const first = await enqueueTask(prisma, { type: 'test:work', dedupeKey: 'once', payload: { n: 1 } }, handlers)
    const second = await enqueueTask(prisma, { type: 'test:work', dedupeKey: 'once', payload: { n: 2 } }, handlers)

    expect(first).toMatchObject({ created: true })
    expect(second).toEqual({ created: false, id: first.id })
    expect(await prisma.taskOutbox.count()).toBe(1)
    // The first caller's payload wins; the second is a duplicate, not an update.
    expect((await prisma.taskOutbox.findUniqueOrThrow({ where: { id: first.id } })).payload).toEqual({ n: 1 })
  })

  test('enqueueing a duplicate inside a transaction does not roll the caller back', async () => {
    // The reason insertTask uses createMany({ skipDuplicates }) rather than catching a unique
    // violation: in PostgreSQL a failed statement poisons the whole transaction, so the recovery
    // read would abort and take the caller's committed-looking business write with it. Callers
    // are told to enqueue inside their own transaction, so this path has to stay clean.
    const handlers = registry(async () => undefined)
    await enqueueTask(prisma, { type: 'test:work', dedupeKey: 'shared', payload: { n: 1 } }, handlers)

    const email = `tx-${crypto.randomUUID()}@example.com`
    await prisma.$transaction(async (tx) => {
      await tx.user.create({ data: { email, passwordHash: 'hash' } })
      const again = await enqueueTask(tx, { type: 'test:work', dedupeKey: 'shared', payload: { n: 2 } }, handlers)
      expect(again.created).toBe(false)
    })

    // Both survived: the duplicate was absorbed, the business write committed.
    expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull()
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: 'shared' } })).toBe(1)
    await prisma.user.deleteMany({ where: { email } })
  })

  test('a write from a superseded lease changes nothing', async () => {
    const handlers = registry(async () => undefined)
    const { id } = await enqueueTask(prisma, { type: 'test:work', dedupeKey: 'fenced', payload: {} }, handlers)

    const mine = await claimTask(prisma, { id, now: now() })
    expect(mine).not.toBeNull()

    // Someone else recovers the lease and finishes the work.
    await prisma.taskOutbox.update({
      where: { id },
      data: { processingToken: null, status: 'pending' },
    })
    const theirs = await claimTask(prisma, { id, now: now() })
    expect(theirs).not.toBeNull()

    const owned = await completeTask(prisma, {
      completion: { attempts: 1, kind: 'terminal', lastError: null, status: 'done' },
      id,
      now: now(),
      processingToken: mine!,
    })

    expect(owned).toBe(false)
    expect((await prisma.taskOutbox.findUniqueOrThrow({ where: { id } })).status).toBe('processing')
  })

  test('claiming a row restarts its lease clock', async () => {
    // Everything about lease recovery rests on Prisma bumping `updated_at` during the claiming
    // updateMany. If that ever stops - a raw-SQL rewrite, a Prisma major - every row that sat
    // pending longer than the lease becomes instantly recoverable while its runner is working,
    // and the same task runs twice with nothing failing.
    const handlers = registry(async () => undefined)
    const { id } = await enqueueTask(prisma, { type: 'test:work', dedupeKey: 'clock', payload: {} }, handlers)
    await prisma.$executeRaw`UPDATE task_outbox SET updated_at = now() - interval '10 minutes' WHERE id = ${id}::uuid`

    const before = await prisma.taskOutbox.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })
    await claimTask(prisma, { id, now: now() })
    const after = await prisma.taskOutbox.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })

    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    expect(Date.now() - after.updatedAt.getTime()).toBeLessThan(60_000)
  })

  test('a lease that went stale is handed back without spending an attempt', async () => {
    const handlers = registry(async () => undefined)
    const { id } = await enqueueTask(prisma, { type: 'test:work', dedupeKey: 'stale', payload: {} }, handlers)
    await prisma.taskOutbox.update({
      where: { id },
      data: { attempts: 2, processingToken: crypto.randomUUID(), status: 'processing' },
    })
    // Backdate past the lease. `updatedAt` is the lease clock, so it has to be written raw.
    await prisma.$executeRaw`UPDATE task_outbox SET updated_at = now() - interval '10 minutes' WHERE id = ${id}::uuid`

    const metrics = await drainTaskOutbox(runtime, { handlers, now: now() })

    expect(metrics.recoveredStale).toBe(1)
    expect(await prisma.taskOutbox.findUniqueOrThrow({ where: { id } })).toMatchObject({
      attempts: 3,
      status: 'done',
    })
  })

  test('a failing task backs off and is given up on after its last attempt', async () => {
    const failing: TaskHandlerRegistry = {
      'test:work': {
        maxAttempts: 2,
        run: async () => {
          throw new Error('provider unavailable')
        },
      },
    }
    const { id } = await enqueueTask(prisma, { type: 'test:work', dedupeKey: 'failing', payload: {} }, failing)

    const first = await drainTaskOutbox(runtime, { handlers: failing, now: now(), random: () => 0 })
    expect(first).toMatchObject({ transientFailed: 1 })

    const retried = await prisma.taskOutbox.findUniqueOrThrow({ where: { id } })
    expect(retried.status).toBe('pending')
    expect(retried.scheduledFor.getTime()).toBeGreaterThan(Date.now())
    expect(retried.lastError).toBe('provider unavailable')

    // Jump the clock forward instead of waiting two minutes.
    const later = new Date(Date.now() + 10 * 60 * 1000)
    const second = await drainTaskOutbox(runtime, { handlers: failing, now: later })

    expect(second).toMatchObject({ terminalFailed: 1 })
    expect(await prisma.taskOutbox.findUniqueOrThrow({ where: { id } })).toMatchObject({
      attempts: 2,
      redactedAt: expect.any(Date),
      status: 'failed',
    })
  })

  test('terminal rows keep their audit skeleton and lose their payload', async () => {
    const handlers = registry(async () => undefined)
    const { id } = await enqueueTask(
      prisma,
      { type: 'test:work', dedupeKey: 'redacted', payload: { email: 'someone@example.com' } },
      handlers,
    )

    await drainTaskOutbox(runtime, { handlers, now: now() })

    const row = await prisma.taskOutbox.findUniqueOrThrow({ where: { id } })
    expect(row.payload).toEqual({})
    expect(row.redactedAt).not.toBeNull()
    // The skeleton that survives carries no address, only the derived dedupe key.
    expect(row.dedupeKey).toBe('redacted')
    expect(row.status).toBe('done')
  })

  test('retention deletes terminal rows past the cutoff and keeps the rest', async () => {
    const handlers = registry(async () => undefined)
    const old = await enqueueTask(prisma, { type: 'test:work', dedupeKey: 'old', payload: {} }, handlers)
    const recent = await enqueueTask(prisma, { type: 'test:work', dedupeKey: 'recent', payload: {} }, handlers)
    await prisma.taskOutbox.updateMany({
      where: { id: { in: [old.id, recent.id] } },
      data: { processedAt: new Date(), redactedAt: new Date(), status: 'done' },
    })
    await prisma.$executeRaw`UPDATE task_outbox SET processed_at = now() - interval '40 days' WHERE id = ${old.id}::uuid`

    const metrics = await drainTaskOutbox(runtime, { handlers, now: now(), retentionDays: 30 })

    expect(metrics.deleted).toBe(1)
    expect(await prisma.taskOutbox.findUnique({ where: { id: old.id } })).toBeNull()
    expect(await prisma.taskOutbox.findUnique({ where: { id: recent.id } })).not.toBeNull()
  })
})
