import { isTerminalTaskError } from './errors'

/**
 * When a failed task is tried again, and when the drain gives up on it.
 *
 * Pure on purpose: the clock and the randomness are both injected, so every rule here is
 * testable without waiting and without flaking.
 */
export const defaultMaxAttempts = 5

/**
 * The first retry must land outside the 60-second password-reset cooldown, or the retry would be
 * swallowed as a cooldown hit and the user would never get a second link. Two minutes leaves
 * margin; `retry-policy.test.ts` asserts it, so lowering this fails loudly.
 */
const baseDelayMs = 2 * 60 * 1000
const maxDelayMs = 15 * 60 * 1000

/**
 * Jitter only ever *adds*, never subtracts. Classic equal jitter would halve the first delay and
 * put it back inside that cooldown, so the lower bound here is load-bearing rather than
 * cosmetic. Spreading upward is still enough: after a provider outage every row comes due at the
 * same instant, and without this they would stampede the provider and the database together.
 */
const jitterFraction = 0.5

/** Attempts already made, including the one that just failed. */
export function nextAttemptDelayMs(attempts: number, random: () => number = Math.random) {
  const exponential = baseDelayMs * 2 ** Math.max(attempts - 1, 0)
  const capped = Math.min(exponential, maxDelayMs)

  return Math.round(capped * (1 + random() * jitterFraction))
}

export function nextAttemptAt(attempts: number, now: Date, random: () => number = Math.random) {
  return new Date(now.getTime() + nextAttemptDelayMs(attempts, random))
}

/** True when a failure on this attempt is the last one the task gets. */
export function isFinalAttempt(attempt: number, maxAttempts: number = defaultMaxAttempts) {
  return attempt >= maxAttempts
}

export function classifyFailure(error: unknown): 'retryable' | 'terminal' {
  return isTerminalTaskError(error) ? 'terminal' : 'retryable'
}

/** How long one attempt may run before its `AbortSignal` fires. */
export const defaultTaskDeadlineMs = 15 * 1000
export const defaultLeaseStaleMs = 2 * 60 * 1000

/**
 * A lease must never expire while an attempt is legitimately still inside its deadline - that
 * would let a second process claim a row whose first runner is still working, and the same task
 * would run twice. Floored at twice the slowest deadline so the two can never cross, whatever an
 * operator puts in the environment.
 */
export function resolveLeaseStaleMs(configuredMs: number, slowestDeadlineMs: number) {
  return Math.max(configuredMs, slowestDeadlineMs * 2)
}
