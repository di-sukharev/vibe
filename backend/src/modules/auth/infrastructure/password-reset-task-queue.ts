import { createHash } from 'node:crypto'

import type { DbClient } from '../../../db'
import { enqueueTask } from '../../../outbox'
import { passwordResetCooldownSeconds, type PasswordResetTaskQueue } from '../application/ports'

/**
 * The bucket is the cooldown: two requests inside one window collapse into a single task, and the
 * cooldown would refuse the second token anyway. Wider than the cooldown and a legitimate second
 * request gets swallowed, so the two move together or not at all.
 */
const requestBucketSeconds = passwordResetCooldownSeconds

export function createPasswordResetTaskQueue(
  prisma: Pick<DbClient, 'taskOutbox'>,
): PasswordResetTaskQueue {
  return {
    enqueuePasswordReset: async ({ email, now }) => {
      await enqueueTask(prisma, {
        // Hashed, and derived only from what was submitted - never from whether an account
        // exists - so the key cannot become an oracle for which addresses are registered. The
        // address itself lives in the payload, which is blanked the moment the task finishes.
        dedupeKey: `${hashAddress(email)}:${Math.floor(now.getTime() / (requestBucketSeconds * 1000))}`,
        payload: { email },
        type: 'auth:password-reset',
      })
    },
  }
}

function hashAddress(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}
