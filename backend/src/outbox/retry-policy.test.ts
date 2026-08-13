import { describe, expect, test } from 'bun:test'

import { TerminalTaskError } from './errors'
import {
  classifyFailure,
  defaultMaxAttempts,
  isFinalAttempt,
  nextAttemptAt,
  nextAttemptDelayMs,
  resolveLeaseStaleMs,
} from './retry-policy'

const noJitter = () => 0
const fullJitter = () => 1

describe('nextAttemptDelayMs', () => {
  test('backs off exponentially and then stops growing', () => {
    const delays = [1, 2, 3, 4, 5, 6].map((attempts) => nextAttemptDelayMs(attempts, noJitter))

    expect(delays).toEqual([120_000, 240_000, 480_000, 900_000, 900_000, 900_000])
  })

  // The first delay must clear the password-reset cooldown, and that lower bound is asserted in
  // `modules/auth/password-reset-cooldown.test.ts` against the real `passwordResetCooldownSeconds`.
  // A copy of the number here would stay green when the cooldown is raised past the backoff, which
  // is the only way that invariant ever breaks.

  test('jitter spreads a retry by up to half its delay and never beyond', () => {
    // After an outage every row comes due at once; without spread they stampede together.
    expect(nextAttemptDelayMs(2, noJitter)).toBe(240_000)
    expect(nextAttemptDelayMs(2, fullJitter)).toBe(360_000)
    expect(nextAttemptDelayMs(2, () => 0.5)).toBe(300_000)
  })

  test('nextAttemptAt moves the due time forward from the injected clock', () => {
    const now = new Date('2026-08-09T10:00:00.000Z')

    expect(nextAttemptAt(1, now, noJitter)).toEqual(new Date('2026-08-09T10:02:00.000Z'))
  })
})

describe('isFinalAttempt', () => {
  test('is true exactly on the last permitted attempt', () => {
    expect([1, 2, 3, 4, 5, 6].map((attempt) => isFinalAttempt(attempt, 5))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ])
  })

  test('a single-attempt task is final immediately, so compensation still runs', () => {
    expect(isFinalAttempt(1, 1)).toBe(true)
  })
})

describe('classifyFailure', () => {
  test('anything the handler did not mark terminal is retried', () => {
    // A generic outbox cannot classify failures from handlers it knows nothing about. Guessing
    // "terminal" would silently drop work the caller was promised; guessing "retryable" costs a
    // few pointless attempts.
    expect(classifyFailure(new Error('provider unavailable'))).toBe('retryable')
    expect(classifyFailure('a thrown string')).toBe('retryable')
    expect(classifyFailure(undefined)).toBe('retryable')
  })

  test('a handler that knows the work can never succeed opts out', () => {
    expect(classifyFailure(new TerminalTaskError('payload will never validate'))).toBe('terminal')
  })
})

describe('resolveLeaseStaleMs', () => {
  test('a lease can never expire while an attempt is still inside its deadline', () => {
    // Otherwise a second process claims a row whose first runner is still working.
    expect(resolveLeaseStaleMs(1_000, 15_000)).toBe(30_000)
    expect(resolveLeaseStaleMs(120_000, 15_000)).toBe(120_000)
  })

})
