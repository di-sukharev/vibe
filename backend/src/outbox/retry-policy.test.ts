import { describe, expect, test } from 'bun:test'

import { TerminalTaskError } from './errors'
import {
  classifyFailure,
  defaultLeaseStaleMs,
  defaultMaxAttempts,
  defaultTaskDeadlineMs,
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

  test('jitter only ever adds, so the first delay clears the password-reset cooldown', () => {
    // The 60-second cooldown in createPasswordResetToken silently swallows a second request for
    // the same account. A retry landing inside it would be dropped and the user would never get
    // a working link, so this lower bound is a correctness property, not tuning.
    const cooldownMs = 60 * 1000

    for (const random of [noJitter, fullJitter, () => 0.5, () => 0.01]) {
      expect(nextAttemptDelayMs(1, random)).toBeGreaterThan(cooldownMs)
    }
  })

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

  test('the shipped defaults leave the deadline well inside the lease', () => {
    expect(defaultTaskDeadlineMs * 2).toBeLessThanOrEqual(defaultLeaseStaleMs)
    expect(defaultMaxAttempts).toBeGreaterThan(1)
  })
})
