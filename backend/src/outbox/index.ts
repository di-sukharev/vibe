import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import { maxLoops, type DrainOptions } from './drain'
import { requireTaskHandler, taskHandlers, type TaskHandlerRegistry } from './handlers'
import { insertTask } from './store'
import type { EnqueueTaskInput, EnqueueTaskResult } from './types'

export { TerminalTaskError } from './errors'
export { drainTaskOutbox, type DrainOptions } from './drain'
export { isTaskType, taskHandlers, taskTypeNames } from './handlers'
export { countClaimableTasks } from './store'
export type {
  DrainMetrics,
  EnqueueTaskInput,
  EnqueueTaskResult,
  TaskHandler,
  TaskHandlerContext,
  TaskHandlerEntry,
  TaskOutcome,
} from './types'

/**
 * Queues durable work. The row is committed before this resolves, so a caller that has awaited it
 * can promise the work will happen even if the process dies immediately afterwards.
 *
 * The type is checked here rather than by a database enum: adding a task type stays a code
 * change, and a typo fails at the call site instead of becoming a row nothing will ever run.
 */
export async function enqueueTask(
  prisma: Pick<DbClient, 'taskOutbox'>,
  input: EnqueueTaskInput,
  registry: TaskHandlerRegistry = taskHandlers,
): Promise<EnqueueTaskResult> {
  // `async` so an unknown type arrives as a rejected promise like every other failure here. A
  // function typed as returning a promise that can also throw synchronously is a trap for any
  // caller that reaches for `.catch()`.
  requireTaskHandler(input.type, registry)

  return insertTask(prisma, input)
}

/**
 * The drain's budget, from the environment. Kept here rather than inside `drain.ts` so the drain
 * itself takes plain numbers and a test can hand it any budget it likes.
 */
export function drainOptionsFromEnv(env: AppEnv): DrainOptions {
  return {
    leaseStaleMs: env.TASK_OUTBOX_LEASE_STALE_MS,
    limit: env.TASK_OUTBOX_BATCH_LIMIT,
    maxRuntimeMs: env.TASK_OUTBOX_MAX_RUNTIME_MS,
    retentionDays: env.TASK_OUTBOX_RETENTION_DAYS,
  }
}

/**
 * The most rows one pass can claim, from the same environment the pass reads its batch from.
 *
 * The right ceiling for a caller that admits work against the drain's pace: the password-reset
 * queue holds at most this many due rows, so nothing the drain could have delivered on time is
 * refused, and what a shared or runtime-bounded pass leaves of them is a bounded remainder that
 * shrinks the next admission rather than a backlog that compounds.
 */
export function drainPassCapacity(env: AppEnv) {
  return env.TASK_OUTBOX_BATCH_LIMIT * maxLoops
}
