import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { createPrismaAvatarsRepository } from './infrastructure/avatars-repository'
import { loadEnv } from '../../env'
import { privateStorageConfigFromEnv, type FilesystemStorageConfig } from '../../storage/config'
import { createFilesystemStorageRoutes } from '../../storage/filesystem-routes'
import { FilesystemPrivateStorage } from '../../storage/filesystem-storage'
import { pngFixture } from '../../storage/storage-contract'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

const jpegFixture = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(pngFixture.byteLength - 4, 0x20),
])

maybeDescribe('avatar upload API integration', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: 'http://localhost:5173',
    ACCESS_TOKEN_TTL_SECONDS: '60',
    // This suite makes many authenticated requests in a row; the default limit would trip.
    AUTH_RATE_LIMIT_MAX: '200',
  })

  const prisma = createPrisma(databaseUrl!)
  let root: string
  let storage: FilesystemPrivateStorage
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    await prisma.userAvatar.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()

    root = await mkdtemp(join(tmpdir(), 'uploads-integration-'))
    const config = privateStorageConfigFromEnv({
      ...env,
      PRIVATE_STORAGE_LOCAL_ROOT: root,
    }) as FilesystemStorageConfig
    storage = new FilesystemPrivateStorage(config)
    app = createApp({
      env,
      prisma,
      privateStorage: { storage, httpRoutes: createFilesystemStorageRoutes(config) },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await rm(root, { recursive: true, force: true })
  })

  async function register(email: string) {
    const response = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password-1234' }),
    })
    expect(response.status).toBe(201)
    return (await response.json()) as { accessToken: string; user: { id: string } }
  }

  function authenticated(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  }

  async function requestTicket(accessToken: string, body: Buffer, contentType: string) {
    const response = await app.request('/api/uploads/avatar', {
      method: 'POST',
      headers: authenticated(accessToken),
      body: JSON.stringify({ contentType, byteSize: body.byteLength }),
    })
    expect(response.status).toBe(201)
    return (await response.json()).upload as {
      uploadId: string
      url: string
      method: string
      headers: Record<string, string>
    }
  }

  async function transfer(ticket: { url: string; headers: Record<string, string> }, body: Buffer) {
    return app.request(ticket.url, {
      method: 'PUT',
      headers: ticket.headers,
      body: new Uint8Array(body),
    })
  }

  async function finalize(accessToken: string, uploadId: string) {
    return app.request(`/api/uploads/avatar/${uploadId}/finalize`, {
      method: 'POST',
      headers: authenticated(accessToken),
    })
  }

  test('carries an avatar from ticket to published, and serves it through a signed URL', async () => {
    const session = await register('avatar@example.com')

    const ticket = await requestTicket(session.accessToken, pngFixture, 'image/png')
    expect((await transfer(ticket, pngFixture)).status).toBe(200)

    const finalized = await finalize(session.accessToken, ticket.uploadId)
    const body = await finalized.json()

    expect(finalized.status).toBe(200)
    expect(body.avatar).toMatchObject({ contentType: 'image/png', byteSize: pngFixture.byteLength })

    const download = await app.request(body.avatar.downloadUrl)
    expect(download.status).toBe(200)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(pngFixture)

    const current = await app.request('/api/uploads/avatar', {
      headers: authenticated(session.accessToken),
    })
    expect((await current.json()).avatar.downloadUrl).toBeTruthy()
  })

  test('reports no avatar for a user who has not uploaded one', async () => {
    const session = await register('empty@example.com')

    const response = await app.request('/api/uploads/avatar', {
      headers: authenticated(session.accessToken),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).avatar).toBeNull()
  })

  test('requires authentication on every avatar route', async () => {
    for (const [path, method] of [
      ['/api/uploads/avatar', 'GET'],
      ['/api/uploads/avatar', 'POST'],
      ['/api/uploads/avatar', 'DELETE'],
      ['/api/uploads/avatar/019c0000-0000-7000-8000-000000000001/finalize', 'POST'],
    ] as const) {
      const response = await app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST' && path === '/api/uploads/avatar'
          ? { body: JSON.stringify({ contentType: 'image/png', byteSize: 1024 }) }
          : {}),
      })
      expect(response.status).toBe(401)
    }
  })

  test('refuses to finalize an upload that never completed, then accepts the retry', async () => {
    const session = await register('interrupted@example.com')
    const ticket = await requestTicket(session.accessToken, pngFixture, 'image/png')

    const premature = await finalize(session.accessToken, ticket.uploadId)
    expect(premature.status).toBe(409)
    expect((await premature.json()).error.code).toBe('UPLOAD_NOT_COMPLETED')

    expect((await transfer(ticket, pngFixture)).status).toBe(200)
    expect((await finalize(session.accessToken, ticket.uploadId)).status).toBe(200)
  })

  test('recovers from an interrupted transfer by issuing a new write-once key', async () => {
    const session = await register('recovery@example.com')

    const abandoned = await requestTicket(session.accessToken, pngFixture, 'image/png')
    expect((await transfer(abandoned, pngFixture)).status).toBe(200)
    // A retry against the same key is refused, which is why a fresh ticket is required.
    expect((await transfer(abandoned, pngFixture)).status).toBe(412)

    const retry = await requestTicket(session.accessToken, pngFixture, 'image/png')
    expect(retry.url).not.toBe(abandoned.url)
    expect((await transfer(retry, pngFixture)).status).toBe(200)
    expect((await finalize(session.accessToken, retry.uploadId)).status).toBe(200)

    // The superseded pending row is gone, so the unique constraint is satisfied.
    expect(await prisma.userAvatar.count({ where: { state: 'pending' } })).toBe(0)
  })

  test('rejects bytes that are not the declared image', async () => {
    const session = await register('mismatch@example.com')
    const ticket = await requestTicket(session.accessToken, pngFixture, 'image/png')

    expect((await transfer(ticket, jpegFixture)).status).toBe(200)

    const finalized = await finalize(session.accessToken, ticket.uploadId)
    expect(finalized.status).toBe(409)
    expect((await finalized.json()).error.code).toBe('UPLOAD_REJECTED')
  })

  test('rejects an upload larger than the declared size at the storage endpoint', async () => {
    const session = await register('oversized@example.com')
    const ticket = await requestTicket(session.accessToken, pngFixture, 'image/png')

    const response = await transfer(ticket, Buffer.concat([pngFixture, Buffer.from([0])]))

    expect(response.status).toBe(403)
  })

  test('rejects an unsupported content type before any bytes move', async () => {
    const session = await register('unsupported@example.com')

    const response = await app.request('/api/uploads/avatar', {
      method: 'POST',
      headers: authenticated(session.accessToken),
      body: JSON.stringify({ contentType: 'image/svg+xml', byteSize: 1024 }),
    })

    expect(response.status).toBe(400)
  })

  test('keeps one live avatar per user and deletes the object it replaces', async () => {
    const session = await register('replace@example.com')

    const first = await requestTicket(session.accessToken, pngFixture, 'image/png')
    await transfer(first, pngFixture)
    await finalize(session.accessToken, first.uploadId)
    const firstKey = (await prisma.userAvatar.findFirstOrThrow({ where: { state: 'ready' } }))
      .objectKey

    const second = await requestTicket(session.accessToken, jpegFixture, 'image/jpeg')
    await transfer(second, jpegFixture)
    const replaced = await finalize(session.accessToken, second.uploadId)

    expect(replaced.status).toBe(200)
    expect((await replaced.json()).avatar.contentType).toBe('image/jpeg')
    expect(await prisma.userAvatar.count({ where: { userId: session.user.id } })).toBe(1)
    await waitForDeletion(firstKey)
  })

  test('never lets one user finalize or read another user’s upload', async () => {
    const owner = await register('owner@example.com')
    const intruder = await register('intruder@example.com')

    const ticket = await requestTicket(owner.accessToken, pngFixture, 'image/png')
    await transfer(ticket, pngFixture)

    expect((await finalize(intruder.accessToken, ticket.uploadId)).status).toBe(404)

    await finalize(owner.accessToken, ticket.uploadId)
    const intruderView = await app.request('/api/uploads/avatar', {
      headers: authenticated(intruder.accessToken),
    })
    expect((await intruderView.json()).avatar).toBeNull()
  })

  test('deletes the avatar and its object, and stays idempotent', async () => {
    const session = await register('delete@example.com')
    const ticket = await requestTicket(session.accessToken, pngFixture, 'image/png')
    await transfer(ticket, pngFixture)
    const published = await finalize(session.accessToken, ticket.uploadId)
    const { downloadUrl } = (await published.json()).avatar
    const key = (await prisma.userAvatar.findFirstOrThrow({ where: { state: 'ready' } })).objectKey

    const removed = await app.request('/api/uploads/avatar', {
      method: 'DELETE',
      headers: authenticated(session.accessToken),
    })

    expect(removed.status).toBe(200)
    expect((await removed.json()).avatar).toBeNull()
    await waitForDeletion(key)
    expect((await app.request(downloadUrl)).status).toBe(404)

    const again = await app.request('/api/uploads/avatar', {
      method: 'DELETE',
      headers: authenticated(session.accessToken),
    })
    expect(again.status).toBe(200)
  })

  test('never lets a lost race delete a published avatar or its object', async () => {
    // Both guards live in the real repository, so they are exercised through it rather than
    // through a fake that could simply mirror them. The scenario is two finalizes of one upload:
    // the winner publishes it, and the loser must neither re-promote it nor discard it.
    const session = await register('race@example.com')
    const ticket = await requestTicket(session.accessToken, pngFixture, 'image/png')
    await transfer(ticket, pngFixture)

    const repository = createPrismaAvatarsRepository(prisma)
    await finalize(session.accessToken, ticket.uploadId)
    const published = await prisma.userAvatar.findFirstOrThrow({ where: { state: 'ready' } })

    // The loser's promote finds nothing pending and reports it, instead of deleting the winner.
    expect(
      await repository.promoteToReady({
        userId: session.user.id,
        uploadId: ticket.uploadId,
        readyAt: new Date(),
      }),
    ).toBeNull()

    // The loser's discard reports no object to delete, so the published bytes are left alone.
    expect(await repository.removePending(session.user.id, ticket.uploadId)).toBeNull()

    const survivor = await prisma.userAvatar.findUniqueOrThrow({ where: { id: published.id } })
    expect(survivor.state).toBe('ready')
    expect(survivor.objectKey).toBe(published.objectKey)
    expect(await storage.headObject(published.objectKey)).not.toBeNull()
  })

  test('removes a user’s avatar rows when the user is deleted', async () => {
    const session = await register('cascade@example.com')
    const ticket = await requestTicket(session.accessToken, pngFixture, 'image/png')
    await transfer(ticket, pngFixture)
    await finalize(session.accessToken, ticket.uploadId)

    await prisma.user.delete({ where: { id: session.user.id } })

    expect(await prisma.userAvatar.count({ where: { userId: session.user.id } })).toBe(0)
  })

  /** Object deletion is deferred past the response on purpose, so poll rather than assume. */
  async function waitForDeletion(objectKey: string) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await storage.headObject(objectKey)) === null) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error(`Storage object ${objectKey} was never deleted`)
  }
})
