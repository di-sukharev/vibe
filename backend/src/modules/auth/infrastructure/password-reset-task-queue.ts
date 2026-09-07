import { createHash } from 'node:crypto'

import type { DbClient } from '../../../db'
import { countClaimableTasks, enqueueTask } from '../../../outbox'
import { passwordResetCooldownSeconds, type PasswordResetTaskQueue } from '../application/ports'

const taskType = 'auth:password-reset'

/**
 * The bucket is the cooldown: two requests inside one window collapse into a single task, and the
 * cooldown would refuse the second token anyway. Wider than the cooldown and a legitimate second
 * request gets swallowed, so the two move together or not at all.
 */
const requestBucketSeconds = passwordResetCooldownSeconds

type PasswordResetTaskQueueOptions = {
  /**
   * How many resets may be waiting for the next drain pass at once.
   *
   * Anyone can reach the request path, so what arrives here is bounded only by the auth rate
   * limit times the addresses an attacker holds, while the drain moves a fixed number of rows a
   * minute. Past this ceiling a request is answered exactly as before and nothing is written.
   * Wired to one drain pass (`TASK_OUTBOX_BATCH_LIMIT` times the loops a pass makes), so
   * everything the ceiling admits is claimable within the next pass and nothing the drain could
   * have delivered on time is refused. What a pass leaves of this type - because other types
   * took their share of it, or `TASK_OUTBOX_MAX_RUNTIME_MS` cut it short - still counts and
   * shrinks the next admission, so the remainder is bounded and never compounds into the
   * backlog this ceiling exists to prevent. See docs/BACKGROUND_JOBS.md.
   */
  pendingLimit: number
}

export function createPasswordResetTaskQueue(
  prisma: Pick<DbClient, 'taskOutbox'>,
  { pendingLimit }: PasswordResetTaskQueueOptions,
): PasswordResetTaskQueue {
  return {
    enqueuePasswordReset: async ({ email, now }) => {
      // Read before the address is looked at, and keyed on nothing the caller sent, so neither
      // its cost nor its answer can say whether an account exists. Served by the
      // `(status, scheduled_for)` index; due rows are the few this ceiling keeps few.
      //
      // Only rows the next pass can claim count - the outbox's own definition, so the ceiling
      // cannot drift from what the drain takes. A reset whose delivery failed is parked as
      // pending with a due time minutes ahead; counting those would let a provider outage fill
      // the ceiling with real resets in backoff and then drop every new request, silently, for
      // as long as the outage lasts. Flood rows do not park: an address with no account is
      // skipped on its first attempt, terminally - only an attempt that fails on the database
      // before the lookup answers goes into backoff.
      //
      // A read followed by a write is not atomic: concurrent requests can overshoot the ceiling
      // by their own number. Accepted - this is a bound on a flood, not an exact count.
      const due = await countClaimableTasks(prisma, { now, types: [taskType] })
      if (due >= pendingLimit) return

      await enqueueTask(prisma, {
        // Hashed, and derived only from what was submitted - never from whether an account
        // exists - so the key cannot become an oracle for which addresses are registered. The
        // address itself lives in the payload, which is blanked the moment the task finishes.
        dedupeKey: `${hashAddress(email)}:${Math.floor(now.getTime() / (requestBucketSeconds * 1000))}`,
        payload: { email },
        // Due on the clock the count just read, not the database's, so an admitted row counts
        // from the moment it is admitted rather than after whatever skew lies between the two.
        scheduledFor: now,
        type: taskType,
      })
    },
  }
}

function hashAddress(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}
