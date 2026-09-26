import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { createPrisma } from './db'
import { loadEnv } from './env'
import { PushDeliveryStatus, PushNotificationOutboxStatus } from './generated/prisma/enums'
import { runBackgroundJob } from './jobs'
import type { BackendRuntime } from './runtime'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; run bun run test:backend:integration')

/**
 * The cleanup jobs decide what to delete with date and state predicates, so what they keep is
 * PostgreSQL behaviour too. Only object storage, an external provider, is faked here.
 */
describe('cleanup jobs against a real database', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    JWT_SECRET: '12345678901234567890123456789012',
    SESSION_ABSOLUTE_TTL_DAYS: '90',
    SESSION_RETENTION_DAYS: '7',
  })
  const prisma = createPrisma(databaseUrl)

  beforeEach(async () => {
    // Sessions, reset tokens and avatars cascade with their user.
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('keeps an abandoned upload whose object could not be deleted, so the next run retries', async () => {
    // The row is the only record of the object key. Dropping it after a failed object delete
    // would strand that object in storage forever.
    const now = new Date()
    const expiresAt = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    const [owner, other] = await Promise.all(
      ['owner', 'other'].map((name) => prisma.user.create({ data: { email: `${name}@example.com` } })),
    )
    const avatar = (userId: string, objectKey: string, state: 'pending' | 'ready') => ({
      byteSize: 70,
      contentType: 'image/png',
      expiresAt,
      objectKey,
      state,
      userId,
    })
    await prisma.userAvatar.createMany({
      data: [
        avatar(owner.id, 'avatars/2026/07/unreachable', 'pending'),
        avatar(other.id, 'avatars/2026/07/abandoned', 'pending'),
        // Published, so never abandoned, however long ago its upload URL expired.
        avatar(owner.id, 'avatars/2026/07/published', 'ready'),
      ],
    })
    const deletedObjects: string[] = []
    const storage = {
      deleteObject: async (objectKey: string) => {
        if (objectKey === 'avatars/2026/07/unreachable') throw new Error('storage unavailable')
        deletedObjects.push(objectKey)
      },
    }
    const log = spyOn(console, 'log').mockImplementation(() => {})
    const error = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await runBackgroundJob(
        'uploads:pending:cleanup',
        { prisma, privateStorage: { storage } } as unknown as BackendRuntime,
        now,
      )
    } finally {
      log.mockRestore()
      error.mockRestore()
    }

    expect(deletedObjects).toEqual(['avatars/2026/07/abandoned'])
    const remaining = await prisma.userAvatar.findMany({ orderBy: { objectKey: 'asc' }, select: { objectKey: true } })
    expect(remaining.map(({ objectKey }) => objectKey)).toEqual([
      'avatars/2026/07/published',
      'avatars/2026/07/unreachable',
    ])
  })

  test('keeps a pending upload until an hour after its signed URL expired', async () => {
    // The hour of slack covers clock skew between the app and the database.
    const now = new Date()
    const user = await prisma.user.create({ data: { email: 'uploading@example.com' } })
    await prisma.userAvatar.create({
      data: {
        byteSize: 70,
        contentType: 'image/png',
        expiresAt: new Date(now.getTime() - 10 * 60 * 1000),
        objectKey: 'avatars/2026/07/recent',
        state: 'pending',
        userId: user.id,
      },
    })
    const deletedObjects: string[] = []
    const storage = {
      deleteObject: async (objectKey: string) => {
        deletedObjects.push(objectKey)
      },
    }
    const log = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runBackgroundJob(
        'uploads:pending:cleanup',
        { prisma, privateStorage: { storage } } as unknown as BackendRuntime,
        now,
      )
    } finally {
      log.mockRestore()
    }

    expect(deletedObjects).toEqual([])
    expect(await prisma.userAvatar.count()).toBe(1)
  })

  test('deletes sessions and reset tokens past their retention and keeps the rest', async () => {
    const now = new Date()
    const day = (offset: number) => new Date(now.getTime() + offset * 24 * 60 * 60 * 1000)
    const user = await prisma.user.create({ data: { email: 'sessions@example.com' } })
    const session = (refreshTokenHash: string, dates: { createdAt?: Date; expiresAt: Date; revokedAt?: Date }) => ({
      refreshTokenHash,
      userId: user.id,
      ...dates,
    })
    await prisma.authSession.createMany({
      data: [
        session('live', { createdAt: day(-1), expiresAt: day(20) }),
        // Expired, but still inside the seven-day retention window.
        session('recently-expired', { expiresAt: day(-6) }),
        session('expired', { expiresAt: day(-8) }),
        session('revoked', { expiresAt: day(20), revokedAt: day(-8) }),
        // Never expired or revoked, but older than the 90-day absolute lifetime plus retention.
        session('outlived', { createdAt: day(-98), expiresAt: day(20) }),
      ],
    })
    await prisma.passwordResetToken.createMany({
      data: [
        { expiresAt: new Date(now.getTime() - 60_000), tokenHash: 'expired', userId: user.id },
        { expiresAt: new Date(now.getTime() + 60_000), tokenHash: 'live', userId: user.id },
      ],
    })
    const log = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runBackgroundJob('auth:sessions:cleanup', { env, prisma } as BackendRuntime, now)
    } finally {
      log.mockRestore()
    }

    const sessions = await prisma.authSession.findMany({
      orderBy: { refreshTokenHash: 'asc' },
      select: { refreshTokenHash: true },
    })
    expect(sessions.map(({ refreshTokenHash }) => refreshTokenHash)).toEqual(['live', 'recently-expired'])
    const tokens = await prisma.passwordResetToken.findMany({ select: { tokenHash: true } })
    expect(tokens.map(({ tokenHash }) => tokenHash)).toEqual(['live'])
  })

  test('maintenance:process runs the auth cleanup and redacts finished push notifications', async () => {
    // The schedule runs these steps only through this job. Each step has its own tests; this one
    // proves the job still calls both.
    const now = new Date()
    const day = (offset: number) => new Date(now.getTime() + offset * 24 * 60 * 60 * 1000)
    const user = await prisma.user.create({ data: { email: 'maintenance@example.com' } })
    await prisma.authSession.createMany({
      data: [
        { createdAt: day(-1), expiresAt: day(20), refreshTokenHash: 'live', userId: user.id },
        { expiresAt: day(-8), refreshTokenHash: 'expired', userId: user.id },
      ],
    })
    const sent = await prisma.pushNotificationOutbox.create({
      data: {
        body: 'Sensitive body',
        data: { href: '/details/maintenance' },
        dedupeKey: 'maintenance-sent',
        processedAt: day(-1),
        status: PushNotificationOutboxStatus.sent,
        title: 'Sensitive title',
        userId: user.id,
        deliveries: {
          create: {
            expoPushToken: 'ExponentPushToken[maintenance]',
            status: PushDeliveryStatus.delivered,
            userId: user.id,
          },
        },
      },
    })
    const log = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runBackgroundJob('maintenance:process', { env, prisma } as BackendRuntime, now)
    } finally {
      log.mockRestore()
    }

    const sessions = await prisma.authSession.findMany({ select: { refreshTokenHash: true } })
    expect(sessions.map(({ refreshTokenHash }) => refreshTokenHash)).toEqual(['live'])
    expect(await prisma.pushNotificationOutbox.findUniqueOrThrow({ where: { id: sent.id } }))
      .toMatchObject({ body: '', data: null, title: '' })
    expect(await prisma.pushDelivery.findFirstOrThrow({ where: { outboxId: sent.id } }))
      .toMatchObject({ expoPushToken: null })
  })
})
