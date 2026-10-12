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
  /** Each removal or replacement also queues object cleanup in its transaction. */
  startUpload(input: StartAvatarUploadInput): Promise<AvatarRecord>
  findPending(userId: string, uploadId: string): Promise<AvatarRecord | null>
  findReady(userId: string): Promise<AvatarRecord | null>
  promoteToReady(input: {
    userId: string
    uploadId: string
    readyAt: Date
  }): Promise<AvatarRecord | null>
  removePending(userId: string, uploadId: string): Promise<boolean>
  removeAll(userId: string): Promise<void>
}

export type Clock = {
  now(): Date
}

export type ObjectKeyFactory = {
  createAvatarKey(now: Date): string
}

export type AvatarMaintenanceStore = {
  findAbandoned(before: Date, limit: number): Promise<Array<{ id: string; objectKey: string }>>
  removeAbandoned(ids: string[]): Promise<number>
}
