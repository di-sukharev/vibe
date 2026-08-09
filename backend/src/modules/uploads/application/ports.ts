import type { AvatarContentType } from '@web-app-demo/contracts'

import type { PrivateStorage } from '../../../storage/port'

/**
 * What the avatar use cases need from the outside world.
 *
 * `PrivateStorage` is imported rather than re-declared: it is already a provider-neutral port
 * owned by `backend/src/storage`, and wrapping it again would add a layer whose only job is
 * renaming. The architecture check allows this because the port carries no SDK types.
 */
export type { PrivateStorage }

export type AvatarState = 'pending' | 'ready'

export type AvatarRecord = {
  id: string
  userId: string
  state: AvatarState
  objectKey: string
  contentType: AvatarContentType
  byteSize: number
  expiresAt: Date
  readyAt: Date | null
  updatedAt: Date
}

export type StartAvatarUploadInput = {
  userId: string
  objectKey: string
  contentType: AvatarContentType
  byteSize: number
  expiresAt: Date
}

export type AvatarRepository = {
  /**
   * Replaces any upload already in flight for this user and returns the new pending row, plus
   * the object key that was abandoned so the caller can clean it up.
   */
  startUpload(input: StartAvatarUploadInput): Promise<{
    pending: AvatarRecord
    replacedObjectKey: string | null
  }>

  findPending(userId: string, uploadId: string): Promise<AvatarRecord | null>

  findReady(userId: string): Promise<AvatarRecord | null>

  /**
   * Promotes the pending row to ready, returning the previous avatar's key to delete.
   * Resolves to `null` when the upload is no longer pending, which is what a concurrent
   * finalize of the same upload looks like from the loser's side.
   */
  promoteToReady(input: {
    userId: string
    uploadId: string
    readyAt: Date
  }): Promise<{ avatar: AvatarRecord; replacedObjectKey: string | null } | null>

  /**
   * Removes a still-pending upload by id and reports the key it pointed at, or `null` when it is
   * no longer pending. Never touches a published avatar.
   */
  removePending(userId: string, uploadId: string): Promise<string | null>

  /** Removes every row for the user and reports the keys to delete. */
  removeAll(userId: string): Promise<string[]>
}

export type Clock = {
  now(): Date
}

export type ObjectKeyFactory = {
  createAvatarKey(now: Date): string
}
