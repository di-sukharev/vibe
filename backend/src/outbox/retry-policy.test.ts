import { describe, expect, test } from 'bun:test'

import { nextAttemptDelayMs } from './retry-policy'

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
})
