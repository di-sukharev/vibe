import type {
  AvatarResponse,
  CreateAvatarUploadRequest,
  CreateAvatarUploadResponse,
} from '@web-app-demo/contracts'

import { UploadsFailure } from '../domain/errors'
import {
  detectImageFormat,
  imageFormatMatchesDeclaredType,
  imageSignatureByteLength,
} from '../domain/image-format'
import type {
  AvatarRecord,
  AvatarRepository,
  Clock,
  ObjectKeyFactory,
  PrivateStorage,
} from './ports'

type AvatarsServiceDependencies = {
  clock: Clock
  objectKeys: ObjectKeyFactory
  repository: AvatarRepository
  storage: PrivateStorage
  /** Deletes that must not fail the request they belong to. */
  deferDelete: (objectKey: string) => void
}

export class AvatarsService {
  constructor(private readonly dependencies: AvatarsServiceDependencies) {}

  /**
   * Issues a fresh upload ticket.
   *
   * A new key every time, deliberately. The key is signed write-once, so reusing one after an
   * interrupted transfer would hand the user a URL that can only ever answer 412. Starting over
   * is what makes a retry work, and the abandoned object is swept up behind the response.
   */
  async createUpload(
    userId: string,
    input: CreateAvatarUploadRequest,
  ): Promise<CreateAvatarUploadResponse> {
    const now = this.dependencies.clock.now()
    const objectKey = this.dependencies.objectKeys.createAvatarKey(now)
    const upload = await this.dependencies.storage.createUploadUrl({
      key: objectKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
    })

    const { pending, replacedObjectKey } = await this.dependencies.repository.startUpload({
      userId,
      objectKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      expiresAt: new Date(upload.expiresAt),
    })

    if (replacedObjectKey) this.dependencies.deferDelete(replacedObjectKey)

    return {
      upload: {
        uploadId: pending.id,
        method: upload.method,
        url: upload.url,
        headers: upload.headers,
        contentLength: upload.contentLength,
        expiresAt: upload.expiresAt,
      },
    }
  }

  /**
   * Confirms that the declared upload is what was actually stored, then publishes it.
   *
   * Each check answers a different recoverable situation, which is why they report distinct
   * failures instead of one generic conflict: the transfer never landed, the window closed, or
   * the bytes are not the image they claimed to be.
   */
  async finalizeUpload(userId: string, uploadId: string): Promise<AvatarResponse> {
    const pending = await this.dependencies.repository.findPending(userId, uploadId)
    if (!pending) throw new UploadsFailure('not_found', 'Upload not found')

    if (pending.expiresAt.getTime() <= this.dependencies.clock.now().getTime()) {
      await this.discard(userId, pending)
      throw new UploadsFailure('expired', 'Upload window has expired; start a new upload')
    }

    const stored = await this.dependencies.storage.headObject(pending.objectKey)
    if (!stored) {
      throw new UploadsFailure('not_completed', 'Upload has not finished; send the file again')
    }

    if (stored.contentLength !== pending.byteSize) {
      await this.discard(userId, pending)
      throw new UploadsFailure('rejected', 'Uploaded file size does not match the request')
    }

    if (!imageFormatMatchesDeclaredType(asAvatarType(stored.contentType), pending.contentType)) {
      await this.discard(userId, pending)
      throw new UploadsFailure('rejected', 'Uploaded file type does not match the request')
    }

    const prefix = await this.dependencies.storage.readRange(pending.objectKey, {
      start: 0,
      end: imageSignatureByteLength - 1,
    })
    const detected = prefix ? detectImageFormat(prefix) : null
    if (!detected || !imageFormatMatchesDeclaredType(detected, pending.contentType)) {
      await this.discard(userId, pending)
      throw new UploadsFailure('rejected', 'Uploaded file is not a supported image')
    }

    const promoted = await this.dependencies.repository.promoteToReady({
      userId,
      uploadId,
      readyAt: this.dependencies.clock.now(),
    })
    // Another finalize of the same upload won the race and already published it. Reporting "not
    // found" matches what a second finalize gets sequentially, and avoids the alternative:
    // deleting the avatar that just succeeded.
    if (!promoted) throw new UploadsFailure('not_found', 'Upload not found')

    if (promoted.replacedObjectKey) this.dependencies.deferDelete(promoted.replacedObjectKey)

    return { avatar: await this.avatarDto(promoted.avatar) }
  }

  async getAvatar(userId: string): Promise<AvatarResponse> {
    const avatar = await this.dependencies.repository.findReady(userId)
    return { avatar: avatar ? await this.avatarDto(avatar) : null }
  }

  /** Idempotent: removing an avatar that is not there is a success, not a 404. */
  async removeAvatar(userId: string): Promise<AvatarResponse> {
    for (const objectKey of await this.dependencies.repository.removeAll(userId)) {
      this.dependencies.deferDelete(objectKey)
    }

    return { avatar: null }
  }

  private async discard(userId: string, pending: AvatarRecord) {
    const objectKey = await this.dependencies.repository.removePending(userId, pending.id)
    if (objectKey) this.dependencies.deferDelete(objectKey)
  }

  private async avatarDto(avatar: AvatarRecord) {
    const download = await this.dependencies.storage.createDownloadUrl({ key: avatar.objectKey })

    return {
      contentType: avatar.contentType,
      byteSize: avatar.byteSize,
      updatedAt: avatar.updatedAt.toISOString(),
      downloadUrl: download.url,
      downloadUrlExpiresAt: download.expiresAt,
    }
  }
}

/**
 * Storage reports whatever content type was stored. Anything outside the supported set fails the
 * comparison against the declared type, which is exactly the outcome we want.
 */
function asAvatarType(contentType: string) {
  return contentType as Parameters<typeof imageFormatMatchesDeclaredType>[0]
}
