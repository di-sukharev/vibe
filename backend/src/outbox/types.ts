import type { BackendRuntime } from '../runtime'

/**
 * What a handler says happened. `skipped` means the handler deliberately did nothing - the
 * account did not exist, the work was already unnecessary - and is not a failure. Keeping the
 * two apart is what stops a silently useless system from looking healthy in the drain metrics.
 */
export type TaskOutcome = 'done' | 'skipped'

export type TaskHandlerContext = {
  /** Raw JSON from the row. The handler validates it; the column cannot. */
  payload: unknown
  /** 1-based, counting this run. */
  attempt: number
  /** True when a failure now is the last one, so compensating work has to happen here. */
  finalAttempt: boolean
  now: Date
  /** Aborts at the entry's `deadlineMs`. Pass it to every provider call. */
  signal: AbortSignal
}

export type TaskHandler = (
  context: TaskHandlerContext,
  runtime: BackendRuntime,
) => Promise<TaskOutcome | void>

export type TaskHandlerEntry = {
  run: TaskHandler
  /** Attempts before the task is given up on and marked `failed`. */
  maxAttempts?: number
  /** How long one attempt may take. Must stay well below the lease - see `resolveLeaseStaleMs`. */
  deadlineMs?: number
}

export type EnqueueTaskInput = {
  type: string
  /** The idempotency boundary. Enqueueing the same `(type, dedupeKey)` twice yields one row. */
  dedupeKey: string
  payload: unknown
  /** Defaults to now. Set it to schedule work into the future. */
  scheduledFor?: Date
}

export type EnqueueTaskResult = {
  id: string
  /** False when an identical `(type, dedupeKey)` was already queued. */
  created: boolean
}

export type DrainMetrics = {
  recoveredStale: number
  claimed: number
  done: number
  skipped: number
  /** Failed but will be tried again. */
  transientFailed: number
  /** Gave up: attempts exhausted, or the handler said the work can never succeed. */
  terminalFailed: number
  /** Rows whose type no runner in this deployment knows. Alert on this being non-zero. */
  unhandled: number
  deleted: number
  /** Rows still due after this pass. Alert on it growing across consecutive runs. */
  backlog: number
  oldestPendingAgeSeconds: number | null
}
