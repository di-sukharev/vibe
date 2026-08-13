/**
 * Service-level rules only: what the ticket promises, when an upload expires, and which bodies are
 * refused.
 *
 * Anything whose answer lives in SQL - write-once keys, replacing a published avatar, one user
 * reaching another's upload, a lost promote or discard race - is tested in
 * `uploads.integration.test.ts` against real Postgres instead. Those cases used to be duplicated
 * here on top of a fake repository that re-implemented the same semantics, which meant the fake
 * and the schema could drift apart with every assertion still green.
 */
import { beforeEach, describe, expect, test } from 'bun:test'

import { pngFixture } from '../../../storage/storage-contract'
import { AvatarsService } from './avatars-service'
import type { AvatarRecord, AvatarRepository, PrivateStorage } from './ports'

const userId = '019c0000-0000-7000-8000-0000000000aa'

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

  test('refuses an expired upload and clears it away', async () => {
    const upload = await uploadPng()
    fakeStorage.advance(901_000)

    await expect(service.finalizeUpload(userId, upload.uploadId)).rejects.toMatchObject({
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

    await expect(service.finalizeUpload(userId, upload.uploadId)).rejects.toMatchObject({
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

    await expect(service.finalizeUpload(userId, upload.uploadId)).rejects.toMatchObject({
      kind: 'rejected',
    })
    await Promise.resolve()
    expect(deleted).toContain(pending.objectKey)
  })

})
