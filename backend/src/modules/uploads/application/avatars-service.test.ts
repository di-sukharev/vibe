import { beforeEach, describe, expect, test } from 'bun:test'

import { pngFixture } from '../../../storage/storage-contract'
import { UploadsFailure } from '../domain/errors'
import { AvatarsService } from './avatars-service'
import type { AvatarRecord, AvatarRepository, PrivateStorage } from './ports'

const userId = '019c0000-0000-7000-8000-0000000000aa'
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])

type StoredObject = { bytes: Uint8Array; contentType: string }

/** An in-memory stand-in for the storage port, exercising the same five operations. */
function createFakeStorage() {
  const objects = new Map<string, StoredObject>()
  let clockMs = Date.parse('2026-08-09T12:00:00.000Z')

  const storage: PrivateStorage = {
    driver: 'filesystem',
    async createUploadUrl(input) {
      return {
        key: input.key,
        method: 'PUT',
        url: `http://storage.test/${input.key}?sig=1`,
        headers: { 'Content-Type': input.contentType, 'If-None-Match': '*' },
        contentLength: input.byteSize,
        expiresAt: new Date(clockMs + 900_000).toISOString(),
      }
    },
    async createDownloadUrl(input) {
      return {
        key: input.key,
        url: `http://storage.test/${input.key}?sig=2`,
        expiresAt: new Date(clockMs + 300_000).toISOString(),
      }
    },
    async headObject(key) {
      const stored = objects.get(key)
      return stored
        ? {
            key,
            contentLength: stored.bytes.byteLength,
            contentType: stored.contentType,
          }
        : null
    },
    async readRange(key, range) {
      const stored = objects.get(key)
      return stored ? stored.bytes.subarray(range.start, range.end + 1) : null
    },
    async deleteObject(key) {
      objects.delete(key)
    },
  }

  return {
    objects,
    storage,
    put(key: string, bytes: Uint8Array, contentType: string) {
      objects.set(key, { bytes, contentType })
    },
    advance(ms: number) {
      clockMs += ms
    },
    get now() {
      return new Date(clockMs)
    },
  }
}

function createFakeRepository() {
  const rows = new Map<string, AvatarRecord>()
  let nextId = 1

  const forUser = (id: string, state: 'pending' | 'ready') =>
    [...rows.values()].find((row) => row.userId === id && row.state === state) ?? null

  const repository: AvatarRepository = {
    async startUpload(input) {
      const abandoned = forUser(input.userId, 'pending')
      if (abandoned) rows.delete(abandoned.id)

      const pending: AvatarRecord = {
        id: `019c0000-0000-7000-8000-00000000${String(nextId++).padStart(4, '0')}`,
        userId: input.userId,
        state: 'pending',
        objectKey: input.objectKey,
        contentType: input.contentType,
        byteSize: input.byteSize,
        expiresAt: input.expiresAt,
        readyAt: null,
        updatedAt: new Date(),
      }
      rows.set(pending.id, pending)

      return { pending, replacedObjectKey: abandoned?.objectKey ?? null }
    },
    async findPending(id, uploadId) {
      const row = rows.get(uploadId)
      return row && row.userId === id && row.state === 'pending' ? row : null
    },
    async findReady(id) {
      return forUser(id, 'ready')
    },
    async promoteToReady({ userId: id, uploadId, readyAt }) {
      const pending = rows.get(uploadId)
      if (!pending || pending.userId !== id || pending.state !== 'pending') return null

      const previous = forUser(id, 'ready')
      if (previous) rows.delete(previous.id)

      const avatar: AvatarRecord = { ...pending, state: 'ready', readyAt, updatedAt: readyAt }
      rows.set(avatar.id, avatar)

      return { avatar, replacedObjectKey: previous?.objectKey ?? null }
    },
    async removePending(id, uploadId) {
      const row = rows.get(uploadId)
      if (!row || row.userId !== id || row.state !== 'pending') return null
      rows.delete(uploadId)
      return row.objectKey
    },
    async removeAll(id) {
      const owned = [...rows.values()].filter((row) => row.userId === id)
      for (const row of owned) rows.delete(row.id)
      return owned.map((row) => row.objectKey)
    },
  }

  return { repository, rows }
}

describe('AvatarsService', () => {
  let fakeStorage: ReturnType<typeof createFakeStorage>
  let fakeRepository: ReturnType<typeof createFakeRepository>
  let deleted: string[]
  let keyCounter: number
  let service: AvatarsService

  beforeEach(() => {
    fakeStorage = createFakeStorage()
    fakeRepository = createFakeRepository()
    deleted = []
    keyCounter = 0
    service = new AvatarsService({
      clock: { now: () => fakeStorage.now },
      deferDelete: (objectKey) => {
        deleted.push(objectKey)
        void fakeStorage.storage.deleteObject(objectKey)
      },
      objectKeys: { createAvatarKey: () => `avatars/2026/08/key-${++keyCounter}` },
      repository: fakeRepository.repository,
      storage: fakeStorage.storage,
    })
  })

  async function uploadPng() {
    const { upload } = await service.createUpload(userId, {
      contentType: 'image/png',
      byteSize: pngFixture.byteLength,
    })
    const pending = fakeRepository.rows.get(upload.uploadId)
    fakeStorage.put(pending!.objectKey, new Uint8Array(pngFixture), 'image/png')
    return upload
  }

  test('issues a ticket carrying the headers the browser must replay', async () => {
    const { upload } = await service.createUpload(userId, {
      contentType: 'image/png',
      byteSize: pngFixture.byteLength,
    })

    expect(upload.method).toBe('PUT')
    expect(upload.headers['If-None-Match']).toBe('*')
    expect(upload.contentLength).toBe(pngFixture.byteLength)
  })

  test('publishes an avatar once the stored bytes match the declared upload', async () => {
    const upload = await uploadPng()

    const { avatar } = await service.finalizeUpload(userId, upload.uploadId)

    expect(avatar?.contentType).toBe('image/png')
    expect(avatar?.byteSize).toBe(pngFixture.byteLength)
    expect(avatar?.downloadUrl).toContain('sig=2')
    expect((await service.getAvatar(userId)).avatar).not.toBeNull()
  })

  test('reports an unfinished transfer separately, and keeps the ticket usable', async () => {
    const { upload } = await service.createUpload(userId, {
      contentType: 'image/png',
      byteSize: pngFixture.byteLength,
    })

    expect(service.finalizeUpload(userId, upload.uploadId)).rejects.toMatchObject({
      kind: 'not_completed',
    })

    // The upload was never discarded, so completing the transfer still works.
    const pending = fakeRepository.rows.get(upload.uploadId)
    fakeStorage.put(pending!.objectKey, new Uint8Array(pngFixture), 'image/png')
    expect((await service.finalizeUpload(userId, upload.uploadId)).avatar).not.toBeNull()
  })

  test('gives an interrupted upload a brand-new key, because keys are write-once', async () => {
    const first = await service.createUpload(userId, {
      contentType: 'image/png',
      byteSize: pngFixture.byteLength,
    })
    const firstKey = fakeRepository.rows.get(first.upload.uploadId)!.objectKey

    const second = await service.createUpload(userId, {
      contentType: 'image/png',
      byteSize: pngFixture.byteLength,
    })
    const secondKey = fakeRepository.rows.get(second.upload.uploadId)!.objectKey

    expect(secondKey).not.toBe(firstKey)
    expect(deleted).toContain(firstKey)
    expect(fakeRepository.rows.get(first.upload.uploadId)).toBeUndefined()
  })

  test('refuses an expired upload and clears it away', async () => {
    const upload = await uploadPng()
    fakeStorage.advance(901_000)

    expect(service.finalizeUpload(userId, upload.uploadId)).rejects.toMatchObject({
      kind: 'expired',
    })
    await Promise.resolve()
    expect(fakeRepository.rows.get(upload.uploadId)).toBeUndefined()
  })

  test('refuses stored bytes whose size does not match the request', async () => {
    const { upload } = await service.createUpload(userId, {
      contentType: 'image/png',
      byteSize: pngFixture.byteLength,
    })
    const pending = fakeRepository.rows.get(upload.uploadId)!
    fakeStorage.put(pending.objectKey, new Uint8Array(pngFixture.subarray(0, 20)), 'image/png')

    expect(service.finalizeUpload(userId, upload.uploadId)).rejects.toMatchObject({
      kind: 'rejected',
    })
  })

  test('refuses a file that is not the image it claims to be', async () => {
    const { upload } = await service.createUpload(userId, {
      contentType: 'image/png',
      byteSize: pngFixture.byteLength,
    })
    const pending = fakeRepository.rows.get(upload.uploadId)!
    const disguised = new Uint8Array(pngFixture.byteLength)
    disguised.set(new TextEncoder().encode('<svg xmlns='), 0)
    fakeStorage.put(pending.objectKey, disguised, 'image/png')

    expect(service.finalizeUpload(userId, upload.uploadId)).rejects.toMatchObject({
      kind: 'rejected',
    })
    await Promise.resolve()
    expect(deleted).toContain(pending.objectKey)
  })

  test('accepts a HEIF-labelled upload of a HEIC container', async () => {
    const heic = new Uint8Array([
      0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ])
    const { upload } = await service.createUpload(userId, {
      contentType: 'image/heif',
      byteSize: heic.byteLength,
    })
    const pending = fakeRepository.rows.get(upload.uploadId)!
    fakeStorage.put(pending.objectKey, heic, 'image/heif')

    expect((await service.finalizeUpload(userId, upload.uploadId)).avatar?.contentType).toBe(
      'image/heif',
    )
  })

  test('deletes the previous avatar when a new one is published', async () => {
    const first = await uploadPng()
    await service.finalizeUpload(userId, first.uploadId)
    const firstKey = fakeRepository.rows.get(first.uploadId)!.objectKey

    const second = await uploadPng()
    await service.finalizeUpload(userId, second.uploadId)

    expect(deleted).toContain(firstKey)
    expect([...fakeRepository.rows.values()].filter((row) => row.state === 'ready')).toHaveLength(1)
  })

  test('yields to a concurrent finalize instead of destroying the avatar it published', async () => {
    // Two finalizes of the same upload: the first promotes it, the second reaches the repository
    // after the row stopped being pending. The loser must report "not found" and queue nothing
    // for deletion - deleting the winner's object is the failure this guard exists to prevent.
    const upload = await uploadPng()
    const objectKey = fakeRepository.rows.get(upload.uploadId)!.objectKey
    const losing = new AvatarsService({
      clock: { now: () => fakeStorage.now },
      deferDelete: (key) => deleted.push(key),
      objectKeys: { createAvatarKey: () => `avatars/2026/08/key-${++keyCounter}` },
      repository: { ...fakeRepository.repository, promoteToReady: async () => null },
      storage: fakeStorage.storage,
    })

    expect(losing.finalizeUpload(userId, upload.uploadId)).rejects.toMatchObject({
      kind: 'not_found',
    })
    await Promise.resolve()

    expect(deleted).not.toContain(objectKey)
    expect(fakeStorage.objects.has(objectKey)).toBe(true)
  })

  test('refuses to discard an upload that another request already published', async () => {
    // `discard` runs on the expiry path, which can lose the same race. Scoping the delete to
    // pending rows is what stops it removing a live avatar and its object.
    const upload = await uploadPng()
    const objectKey = fakeRepository.rows.get(upload.uploadId)!.objectKey
    await service.finalizeUpload(userId, upload.uploadId)

    expect(await fakeRepository.repository.removePending(userId, upload.uploadId)).toBeNull()
    expect(fakeRepository.rows.get(upload.uploadId)?.state).toBe('ready')
  })

  test('never serves or finalizes another user’s upload', async () => {
    const upload = await uploadPng()
    const otherUser = '019c0000-0000-7000-8000-0000000000bb'

    expect(service.finalizeUpload(otherUser, upload.uploadId)).rejects.toBeInstanceOf(
      UploadsFailure,
    )
    expect((await service.getAvatar(otherUser)).avatar).toBeNull()
  })

  test('removes the avatar and its object, and stays idempotent', async () => {
    const upload = await uploadPng()
    await service.finalizeUpload(userId, upload.uploadId)
    const key = fakeRepository.rows.get(upload.uploadId)!.objectKey

    expect((await service.removeAvatar(userId)).avatar).toBeNull()
    expect(deleted).toContain(key)
    expect(fakeStorage.objects.has(key)).toBe(false)

    expect((await service.removeAvatar(userId)).avatar).toBeNull()
    expect((await service.getAvatar(userId)).avatar).toBeNull()
  })

  test('reports no avatar rather than failing when the user never uploaded one', async () => {
    expect((await service.getAvatar(userId)).avatar).toBeNull()
  })

  test('rejects a jpeg body sent under a png ticket', async () => {
    const { upload } = await service.createUpload(userId, {
      contentType: 'image/png',
      byteSize: jpegBytes.byteLength,
    })
    const pending = fakeRepository.rows.get(upload.uploadId)!
    fakeStorage.put(pending.objectKey, jpegBytes, 'image/png')

    expect(service.finalizeUpload(userId, upload.uploadId)).rejects.toMatchObject({
      kind: 'rejected',
    })
  })
})
