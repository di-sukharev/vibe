import type { AvatarContentType } from '@web-app-demo/contracts'

import { acquireUserAvatarMutationLock, type DbClient } from '../../../db'
import type {
  AvatarRecord,
  AvatarRepository,
  StartAvatarUploadInput,
} from '../application/ports'

type UserAvatarRow = {
  id: string
  userId: string
  state: 'pending' | 'ready'
  objectKey: string
  contentType: string
  byteSize: number
  expiresAt: Date
  readyAt: Date | null
  updatedAt: Date
}

/**
 * Every write runs inside a transaction that first takes the per-user avatar lock, and every one
 * of them re-reads the row it is about to move under that lock. Reading outside it and acting on
 * the result is the shape that lets a request destroy an avatar another request just published.
 *
 * `@@unique([userId, state])` is what guarantees a user cannot end up with two live avatars, but
 * a unique index turns a race into a constraint error rather than a correct outcome. The lock
 * makes concurrent requests queue, so the constraint stays a safety net rather than a code path.
 */
export function createPrismaAvatarsRepository(db: DbClient): AvatarRepository {
  return {
    async startUpload(input: StartAvatarUploadInput) {
      return db.$transaction(async (tx) => {
        await acquireUserAvatarMutationLock(tx, input.userId)

        const abandoned = await tx.userAvatar.findUnique({
          where: { userId_state: { userId: input.userId, state: 'pending' } },
        })

        if (abandoned) {
          await tx.userAvatar.delete({ where: { id: abandoned.id } })
        }

        const pending = await tx.userAvatar.create({
          data: {
            userId: input.userId,
            state: 'pending',
            objectKey: input.objectKey,
            contentType: input.contentType,
            byteSize: input.byteSize,
            expiresAt: input.expiresAt,
          },
        })

        return {
          pending: toAvatarRecord(pending),
          replacedObjectKey: abandoned?.objectKey ?? null,
        }
      })
    },

    async findPending(userId: string, uploadId: string) {
      const row = await db.userAvatar.findFirst({
        where: { id: uploadId, userId, state: 'pending' },
      })
      return row ? toAvatarRecord(row) : null
    },

    async findReady(userId: string) {
      const row = await db.userAvatar.findUnique({
        where: { userId_state: { userId, state: 'ready' } },
      })
      return row ? toAvatarRecord(row) : null
    },

    async promoteToReady({ userId, uploadId, readyAt }) {
      return db.$transaction(async (tx) => {
        await acquireUserAvatarMutationLock(tx, userId)

        // Re-read inside the lock. The caller checked this row was pending before verifying the
        // stored bytes, which takes two storage round trips - long enough for a concurrent
        // finalize of the same upload to have already promoted it.
        const pending = await tx.userAvatar.findFirst({
          where: { id: uploadId, userId, state: 'pending' },
        })
        if (!pending) return null

        const previous = await tx.userAvatar.findUnique({
          where: { userId_state: { userId, state: 'ready' } },
        })

        // The old row goes first: `@@unique([userId, state])` cannot hold two ready rows even
        // for the length of a statement. `previous` can never be this upload, because the row
        // was just confirmed pending under the same lock.
        if (previous) {
          await tx.userAvatar.delete({ where: { id: previous.id } })
        }

        const avatar = await tx.userAvatar.update({
          where: { id: uploadId },
          data: { state: 'ready', readyAt },
        })

        return {
          avatar: toAvatarRecord(avatar),
          replacedObjectKey: previous?.objectKey ?? null,
        }
      })
    },

    async removePending(userId: string, uploadId: string) {
      return db.$transaction(async (tx) => {
        await acquireUserAvatarMutationLock(tx, userId)

        // Read and delete under the same lock. Reading outside it and acting on the result is
        // what lets this hand the caller the object key of a row a concurrent finalize just
        // published - and the caller deletes what it is given, leaving a live avatar row
        // pointing at bytes that no longer exist. The lock is what makes the pair atomic, so a
        // row found pending here is still pending when it is deleted.
        const pending = await tx.userAvatar.findFirst({
          where: { id: uploadId, userId, state: 'pending' },
        })
        if (!pending) return null

        await tx.userAvatar.delete({ where: { id: pending.id } })

        return pending.objectKey
      })
    },

    async removeAll(userId: string) {
      return db.$transaction(async (tx) => {
        await acquireUserAvatarMutationLock(tx, userId)

        const rows = await tx.userAvatar.findMany({ where: { userId } })
        await tx.userAvatar.deleteMany({ where: { userId } })

        return rows.map((row) => row.objectKey)
      })
    },
  }
}

function toAvatarRecord(row: UserAvatarRow): AvatarRecord {
  return {
    id: row.id,
    userId: row.userId,
    state: row.state,
    objectKey: row.objectKey,
    contentType: row.contentType as AvatarContentType,
    byteSize: row.byteSize,
    expiresAt: row.expiresAt,
    readyAt: row.readyAt,
    updatedAt: row.updatedAt,
  }
}
