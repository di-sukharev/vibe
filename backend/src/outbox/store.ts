import { randomUUID } from 'node:crypto'

import type { DbClient } from '../db'
import type { EnqueueTaskInput, EnqueueTaskResult } from './types'

/**
 * Every statement the outbox runs. Kept apart from `drain.ts` so the drain reads as policy and
 * can be tested against a fake client without wading through query shapes.
 */
export type OutboxPrisma = Pick<DbClient, 'taskOutbox'>

/** Statuses a row can no longer move out of. */
export const terminalStatuses = ['done', 'skipped', 'failed'] as const

const emptyPayload = {}

/**
 * Losing the dedupe race is the point of the key, not a failure, so this must not raise.
 *
 * `createMany({ skipDuplicates })` rather than a `create` with a caught P2002: in PostgreSQL a
 * failed statement poisons the surrounding transaction, so the recovery read would itself fail
 * with "current transaction is aborted" and roll back the caller's work. Callers are expected to
 * enqueue inside their own transaction - that is the whole point of the outbox - so this path has
 * to stay clean rather than merely recoverable.
 */
export async function insertTask(
  prisma: OutboxPrisma,
  input: EnqueueTaskInput,
): Promise<EnqueueTaskResult> {
  const { count } = await prisma.taskOutbox.createMany({
    data: [
      {
        type: input.type,
        dedupeKey: input.dedupeKey,
        payload: input.payload as never,
        ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
      },
    ],
    skipDuplicates: true,
  })

  const row = await prisma.taskOutbox.findUniqueOrThrow({
    where: { type_dedupeKey: { type: input.type, dedupeKey: input.dedupeKey } },
    select: { id: true },
  })

  return { created: count === 1, id: row.id }
}

/**
 * Hands back rows whose runner died holding them.
 *
 * `attempts` is deliberately untouched: the task never got a fair attempt, and a deploy in the
 * middle of a pass must not spend one of the retries the caller was promised.
 */
export async function recoverStaleLeases(
  prisma: OutboxPrisma,
  { leaseStaleMs, now }: { leaseStaleMs: number; now: Date },
) {
  const { count } = await prisma.taskOutbox.updateMany({
    where: { status: 'processing', updatedAt: { lt: new Date(now.getTime() - leaseStaleMs) } },
    data: {
      // `lastError` is deliberately left alone: the previous attempt's real error is a better
      // diagnostic than a generic recovery marker, and the recovery itself is already reported
      // as `recoveredStale` in the drain metrics.
      processedAt: null,
      processingToken: null,
      scheduledFor: now,
      status: 'pending',
    },
  })

  return count
}

export function findClaimableTasks(
  prisma: OutboxPrisma,
  { limit, now, types }: { limit: number; now: Date; types: readonly string[] },
) {
  return prisma.taskOutbox.findMany({
    where: { status: 'pending', scheduledFor: { lte: now }, type: { in: [...types] } },
    // Best-effort FIFO. A task type that needs a stronger ordering guarantee than this is not a
    // job for a shared outbox table.
    orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
    select: { attempts: true, id: true, payload: true, type: true },
    take: limit,
  })
}

/**
 * Takes exclusive ownership of one row, or returns null if someone else got there first.
 *
 * No advisory lock: under READ COMMITTED two concurrent updates of the same row serialise on its
 * row lock, and the loser re-evaluates `status = 'pending'` against the winner's committed value
 * and matches nothing. The returned token is what every later write re-asserts.
 */
export async function claimTask(
  prisma: OutboxPrisma,
  { id, now }: { id: string; now: Date },
) {
  const processingToken = randomUUID()
  const { count } = await prisma.taskOutbox.updateMany({
    where: { id, status: 'pending', scheduledFor: { lte: now } },
    data: { processingToken, status: 'processing' },
  })

  return count === 1 ? processingToken : null
}

export type TaskCompletion =
  | { kind: 'terminal'; attempts: number; lastError: string | null; status: 'done' | 'skipped' | 'failed' }
  | { kind: 'retry'; attempts: number; lastError: string; scheduledFor: Date }

/**
 * The single write that ends an attempt, fenced on the token from `claimTask`.
 *
 * Returns false when this process no longer owns the row - its lease went stale and someone else
 * picked the work up. The caller must then write nothing at all, or it would overwrite the
 * result of whoever actually did the work.
 */
export async function completeTask(
  prisma: OutboxPrisma,
  {
    completion,
    id,
    now,
    processingToken,
  }: { completion: TaskCompletion; id: string; now: Date; processingToken: string },
) {
  const data =
    completion.kind === 'terminal'
      ? {
          attempts: completion.attempts,
          lastError: completion.lastError,
          // Terminal rows keep their audit skeleton but lose their payload immediately; the
          // sweeper below only exists for rows whose process died before reaching this line.
          payload: emptyPayload,
          processedAt: now,
          processingToken: null,
          redactedAt: now,
          status: completion.status,
        }
      : {
          attempts: completion.attempts,
          lastError: completion.lastError,
          processedAt: null,
          processingToken: null,
          scheduledFor: completion.scheduledFor,
          status: 'pending' as const,
        }

  const { count } = await prisma.taskOutbox.updateMany({
    where: { id, processingToken, status: 'processing' },
    data,
  })

  return count === 1
}

/**
 * The table has no owning row to cascade from, so without this it grows forever. Bounded per run
 * so a long-neglected install does not turn one drain into a table scan.
 */
export async function deleteExpiredTasks(
  prisma: OutboxPrisma,
  { limit, now, retentionDays }: { limit: number; now: Date; retentionDays: number },
) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const expired = await prisma.taskOutbox.findMany({
    where: { status: { in: [...terminalStatuses] }, processedAt: { lt: cutoff } },
    orderBy: { processedAt: 'asc' },
    select: { id: true },
    take: limit,
  })

  if (expired.length === 0) return 0

  const { count } = await prisma.taskOutbox.deleteMany({
    where: { id: { in: expired.map((row) => row.id) } },
  })

  return count
}

/** What is still waiting once a pass is over: the number to alert on when it climbs. */
export async function summarizeBacklog(
  prisma: OutboxPrisma,
  { now, types }: { now: Date; types: readonly string[] },
) {
  const due = { status: 'pending' as const, scheduledFor: { lte: now }, type: { in: [...types] } }
  const [backlog, oldest, unhandled] = await Promise.all([
    prisma.taskOutbox.count({ where: due }),
    prisma.taskOutbox.findFirst({
      where: due,
      orderBy: { scheduledFor: 'asc' },
      select: { scheduledFor: true },
    }),
    // A type this deployment has no handler for: an API already enqueueing work that the runner
    // shipping alongside it cannot do yet. Never claimed, so it waits for the rollforward.
    prisma.taskOutbox.count({
      where: { status: 'pending', scheduledFor: { lte: now }, type: { notIn: [...types] } },
    }),
  ])

  return {
    backlog,
    oldestPendingAgeSeconds: oldest
      ? Math.max(0, Math.floor((now.getTime() - oldest.scheduledFor.getTime()) / 1000))
      : null,
    unhandled,
  }
}
