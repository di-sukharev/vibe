import type { BackendRuntime } from '../runtime'
import { requireTaskHandler, taskHandlers, taskTypeNames, type TaskHandlerRegistry } from './handlers'
import {
  classifyFailure,
  defaultLeaseStaleMs,
  defaultMaxAttempts,
  defaultTaskDeadlineMs,
  isFinalAttempt,
  nextAttemptAt,
  resolveLeaseStaleMs,
} from './retry-policy'
import {
  claimTask,
  completeTask,
  deleteExpiredTasks,
  findClaimableTasks,
  recoverStaleLeases,
  summarizeBacklog,
} from './store'
import type { DrainMetrics, TaskOutcome } from './types'

export type DrainOptions = {
  now?: Date
  /** Rows fetched per loop. */
  limit?: number
  /** Whole-pass budget, checked between items so a pass overruns by at most one deadline. */
  maxRuntimeMs?: number
  leaseStaleMs?: number
  retentionDays?: number
  /**
   * Read once per attempt, not once per pass.
   *
   * A handler's own deadlines are measured from real time - the password-reset cooldown starts
   * when the token row is written - so scheduling a retry from the pass start would shorten it by
   * however long the pass had already been running. A long pass could then push the next attempt
   * inside the cooldown, where it is silently swallowed and the work is lost.
   */
  clock?: () => Date
  /** Injectable so tests can drive real handlers without touching the shipped registry. */
  handlers?: TaskHandlerRegistry
  random?: () => number
}

/**
 * How many times a pass refills its batch before leaving the rest to the next run.
 *
 * With the batch limit this sets the ceiling on one pass: `limit * maxLoops` rows. Concurrent
 * drains do not raise it - they read the same ordered window and mostly lose claims to each
 * other - so a backlog is cleared by a bigger batch or a shorter interval, not by more workers.
 */
const maxLoops = 5
const sweepLimit = 100

const defaults = {
  limit: 50,
  maxRuntimeMs: 55_000,
  retentionDays: 30,
}

/**
 * One bounded pass over the outbox: recover, run what is due, then tidy up if there is budget
 * left. Safe to run concurrently - every row is taken by a fenced claim, so two drains split the
 * work rather than duplicating it.
 */
export async function drainTaskOutbox(
  runtime: BackendRuntime,
  options: DrainOptions = {},
): Promise<DrainMetrics> {
  const handlers = options.handlers ?? taskHandlers
  const clock = options.clock ?? (() => new Date())
  // The pass clock: which rows are due, which leases are stale, what is old enough to delete.
  // An attempt's own clock comes from `clock()` when it starts.
  const now = options.now ?? clock()
  const limit = options.limit ?? defaults.limit
  const maxRuntimeMs = options.maxRuntimeMs ?? defaults.maxRuntimeMs
  const retentionDays = options.retentionDays ?? defaults.retentionDays
  const types = taskTypeNames(handlers)
  const leaseStaleMs = resolveLeaseStaleMs(
    options.leaseStaleMs ?? defaultLeaseStaleMs,
    slowestDeadlineMs(handlers),
  )

  const { prisma } = runtime
  const startedAt = Date.now()
  const metrics: DrainMetrics = {
    backlog: 0,
    claimed: 0,
    deleted: 0,
    done: 0,
    oldestPendingAgeSeconds: null,
    recoveredStale: 0,
    skipped: 0,
    terminalFailed: 0,
    transientFailed: 0,
    unhandled: 0,
  }

  // Before anything else: rows abandoned by a process that died holding them are due again.
  metrics.recoveredStale = await recoverStaleLeases(prisma, { leaseStaleMs, now })

  for (let loop = 0; loop < maxLoops; loop += 1) {
    if (types.length === 0 || Date.now() - startedAt >= maxRuntimeMs) break

    const candidates = await findClaimableTasks(prisma, { limit, now, types })
    if (candidates.length === 0) break

    for (const candidate of candidates) {
      if (Date.now() - startedAt >= maxRuntimeMs) break

      const processingToken = await claimTask(prisma, { id: candidate.id, now })
      // Another drain got there first. Not an error, and deliberately not counted as one.
      if (!processingToken) continue

      metrics.claimed += 1
      await runClaimedTask({
        candidate,
        handlers,
        metrics,
        now: clock(),
        options,
        processingToken,
        runtime,
      })
    }
  }

  // No redaction sweep: `completeTask` writes the terminal status, the blank payload and
  // `redactedAt` in one statement and is the only writer of a terminal status, so a terminal row
  // that still holds its payload cannot exist. A sweep for it would seq-scan the whole retained
  // table on every pass and always return nothing.
  if (Date.now() - startedAt < maxRuntimeMs) {
    metrics.deleted = await deleteExpiredTasks(prisma, { limit: sweepLimit, now, retentionDays })
  }

  const summary = await summarizeBacklog(prisma, { now, types })
  metrics.backlog = summary.backlog
  metrics.oldestPendingAgeSeconds = summary.oldestPendingAgeSeconds
  metrics.unhandled = summary.unhandled

  return metrics
}

async function runClaimedTask({
  candidate,
  handlers,
  metrics,
  now,
  options,
  processingToken,
  runtime,
}: {
  candidate: { attempts: number; id: string; payload: unknown; type: string }
  handlers: TaskHandlerRegistry
  metrics: DrainMetrics
  now: Date
  options: DrainOptions
  processingToken: string
  runtime: BackendRuntime
}) {
  const entry = requireTaskHandler(candidate.type, handlers)
  const attempt = candidate.attempts + 1
  const finalAttempt = isFinalAttempt(attempt, entry.maxAttempts ?? defaultMaxAttempts)

  // The work and the bookkeeping fail for different reasons and are handled apart. Folding them
  // into one `try` would record a database blip while writing the result as a failure of the
  // task itself, and retry work that had already succeeded.
  const deadlineMs = entry.deadlineMs ?? defaultTaskDeadlineMs
  let status: TaskOutcome
  try {
    status =
      (await withDeadline(
        (signal) => entry.run({ attempt, finalAttempt, now, payload: candidate.payload, signal }, runtime),
        { deadlineMs, type: candidate.type },
      )) ?? 'done'
  } catch (error) {
    await recordFailure({
      attempt,
      candidate,
      error,
      finalAttempt: finalAttempt || classifyFailure(error) === 'terminal',
      metrics,
      now,
      options,
      processingToken,
      runtime,
    })
    return
  }

  const owned = await completeTask(runtime.prisma, {
    completion: { attempts: attempt, kind: 'terminal', lastError: null, status },
    id: candidate.id,
    now,
    processingToken,
  }).catch((error: unknown) => {
    // The side effect happened but we could not record it. Leaving the row `processing` lets
    // lease recovery hand it back rather than aborting the whole pass; the handler contract is
    // at-least-once precisely so this is survivable.
    console.error(`Task ${candidate.type} ${candidate.id} ran but its result could not be recorded.`, error)
    return false
  })

  // Losing the row here means our lease went stale and someone else redid the work. Their
  // result stands; ours must not be written over it, and must not be counted either.
  if (!owned) return

  if (status === 'skipped') metrics.skipped += 1
  else metrics.done += 1
}

async function recordFailure({
  attempt,
  candidate,
  error,
  finalAttempt,
  metrics,
  now,
  options,
  processingToken,
  runtime,
}: {
  attempt: number
  candidate: { id: string; type: string }
  error: unknown
  finalAttempt: boolean
  metrics: DrainMetrics
  now: Date
  options: DrainOptions
  processingToken: string
  runtime: BackendRuntime
}) {
  const lastError = errorMessage(error)
  const owned = await completeTask(runtime.prisma, {
    completion: finalAttempt
      ? { attempts: attempt, kind: 'terminal', lastError, status: 'failed' }
      : {
          attempts: attempt,
          kind: 'retry',
          lastError,
          scheduledFor: nextAttemptAt(attempt, now, options.random),
        },
    id: candidate.id,
    now,
    processingToken,
  }).catch((error: unknown) => {
    // Same reasoning as the success path: the row stays `processing` and lease recovery hands it
    // back, rather than one database blip ending the whole pass.
    console.error(`Task ${candidate.type} ${candidate.id} failed, and that could not be recorded.`, error)
    return false
  })

  if (!owned) return

  if (finalAttempt) {
    metrics.terminalFailed += 1
    console.error(`Task ${candidate.type} ${candidate.id} gave up after ${attempt} attempts.`, error)
    return
  }

  metrics.transientFailed += 1
}

/**
 * Stops waiting on a handler that has run past its deadline.
 *
 * Handing a handler an `AbortSignal` is a request, not a guarantee - a Prisma call, for one,
 * takes no signal at all. Without this the drain would wait forever on one uncooperative task:
 * the scheduler's tick never resolves, croner's overlap guard suppresses every later tick, and
 * durable delivery stops with nothing in the log and nothing in `backlog`.
 *
 * The abandoned work keeps running to its own end - it cannot be killed - so its side effects may
 * still land. That is the at-least-once contract the handler contract already requires, and the
 * row is retried rather than lost.
 */
function withDeadline<Result>(
  work: (signal: AbortSignal) => Promise<Result>,
  { deadlineMs, type }: { deadlineMs: number; type: string },
) {
  const signal = AbortSignal.timeout(deadlineMs)
  const running = work(signal)

  return Promise.race([
    // A rejection arriving after the race is lost would otherwise be unhandled.
    running.catch((error: unknown) => {
      if (!signal.aborted) throw error
      return undefined as Result
    }),
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new Error(`Task ${type} did not finish within its ${deadlineMs}ms deadline`)),
        { once: true },
      )
    }),
  ])
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function slowestDeadlineMs(handlers: TaskHandlerRegistry) {
  return Object.values(handlers).reduce(
    (slowest, entry) => Math.max(slowest, entry.deadlineMs ?? defaultTaskDeadlineMs),
    defaultTaskDeadlineMs,
  )
}
