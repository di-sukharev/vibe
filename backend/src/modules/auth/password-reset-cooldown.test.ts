import { expect, test } from 'bun:test'

import { nextAttemptDelayMs } from '../../outbox/retry-policy'
import { passwordResetCooldownSeconds } from './application/ports'

test('an outbox retry always lands outside the password-reset cooldown', () => {
  // These two numbers live in different modules and are joined only by this assertion. Raise the
  // cooldown past the first backoff and every retry is refused by `createPasswordResetToken`,
  // `deliverPasswordReset` returns 'skipped', the row goes terminal, and the user never gets a
  // link - the exact silent loss the outbox exists to remove, with a green suite.
  const cooldownMs = passwordResetCooldownSeconds * 1000

  // Worst case is no jitter at all; jitter here only ever adds.
  expect(nextAttemptDelayMs(1, () => 0)).toBeGreaterThan(cooldownMs)
})
