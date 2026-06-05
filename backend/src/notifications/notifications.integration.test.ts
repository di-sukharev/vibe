import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../app'
import { createPrisma } from '../db'
import type { AppEnv } from '../env'
import { PushDeliveryStatus, PushNotificationOutboxStatus } from '../generated/prisma/enums'
import {
  checkPushReceipts,
  claimPushOutboxItemForProcessing,
  enqueuePushNotification,
  processPushOutbox,
} from './service'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const originalFetch = globalThis.fetch

maybeDescribe('push notification API and outbox', () => {
  const env: AppEnv = {
    PORT: 3000,
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: ['http://localhost:5173'],
    ACCESS_TOKEN_TTL_SECONDS: 60,
    REFRESH_TOKEN_TTL_DAYS: 30,
    COOKIE_SECURE: false,
    SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    SPACES_UPLOAD_URL_TTL_SECONDS: 900,
    SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
    SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
    APPLE_IAP_ENVIRONMENT: 'Sandbox',
    APPLE_IAP_PRODUCT_IDS: [],
    APPLE_AUTH_JWKS_TIMEOUT_MS: 5000,
    GOOGLE_AUTH_CLIENT_IDS: [],
    GOOGLE_PLAY_PRODUCT_IDS: [],
    GOOGLE_PLAY_BASE_PLAN_IDS: [],
  }
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    globalThis.fetch = originalFetch
    await prisma.pushDelivery.deleteMany()
    await prisma.pushNotificationOutbox.deleteMany()
    await prisma.pushToken.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    globalThis.fetch = originalFetch
    await prisma.$disconnect()
  })

  test('authenticated users can register and unregister Expo push tokens', async () => {
    const session = await registerUser('push-token@example.com')

    const save = await app.request('/api/notifications/push-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: 'device-1',
        expoPushToken: 'ExponentPushToken[token-1]',
        platform: 'ios',
      }),
    })
    expect(save.status).toBe(200)

    const savedToken = await prisma.pushToken.findUnique({
      where: {
        expoPushToken: 'ExponentPushToken[token-1]',
      },
    })
    expect(savedToken?.userId).toBe(session.userId)
    expect(savedToken?.platform).toBe('ios')

    const unauthorized = await app.request('/api/notifications/push-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expoPushToken: 'ExponentPushToken[token-unauthorized]',
      }),
    })
    expect(unauthorized.status).toBe(401)

    const unregister = await app.request('/api/notifications/push-token/unregister', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expoPushToken: 'ExponentPushToken[token-1]',
      }),
    })
    expect(unregister.status).toBe(200)
    expect(await prisma.pushToken.count()).toBe(0)
  })

  test('processPushOutbox sends tickets and checkPushReceipts marks delivery', async () => {
    const session = await registerUser('delivery@example.com')
    const sentAt = new Date('2026-05-21T12:00:00.000Z')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[delivery-token]',
        userId: session.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Delivery body',
      data: { href: '/details/components' },
      dedupeKey: 'delivery-test',
      scheduledFor: sentAt,
      title: 'Delivery title',
      userId: session.userId,
    })
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/push/send')) {
        expect(JSON.parse(String(init?.body))).toMatchObject([
          {
            body: 'Delivery body',
            data: { href: '/details/components' },
            title: 'Delivery title',
            to: 'ExponentPushToken[delivery-token]',
          },
        ])
        return json({
          data: [{ id: 'ticket-delivery', status: 'ok' }],
        })
      }

      expect(JSON.parse(String(init?.body))).toEqual({ ids: ['ticket-delivery'] })
      return json({
        data: {
          'ticket-delivery': { status: 'ok' },
        },
      })
    })

    const outboxMetrics = await processPushOutbox(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now: sentAt, onlyIds: [queued.id] },
    )
    expect(outboxMetrics.sent).toBe(1)

    const delivery = await prisma.pushDelivery.findFirstOrThrow({
      where: {
        outboxId: queued.id,
      },
    })
    expect(delivery.status).toBe(PushDeliveryStatus.sent)
    expect(delivery.ticketId).toBe('ticket-delivery')
    expect(delivery.receiptNextCheckAt?.getTime()).toBeGreaterThan(sentAt.getTime())

    const receiptMetrics = await checkPushReceipts(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now: new Date(sentAt.getTime() + 20_000) },
    )
    expect(receiptMetrics.delivered).toBe(1)

    const delivered = await prisma.pushDelivery.findUniqueOrThrow({
      where: {
        id: delivery.id,
      },
    })
    expect(delivered.status).toBe(PushDeliveryStatus.delivered)
    expect(delivered.receiptNextCheckAt).toBeNull()
  })

  test('enqueuePushNotification dedupes per user instead of globally', async () => {
    const firstSession = await registerUser('dedupe-one@example.com')
    const secondSession = await registerUser('dedupe-two@example.com')

    const first = await enqueuePushNotification(prisma, {
      body: 'Dedupe body',
      dedupeKey: 'shared-event-key',
      title: 'Dedupe title',
      userId: firstSession.userId,
    })
    const duplicateFirst = await enqueuePushNotification(prisma, {
      body: 'Dedupe body',
      dedupeKey: 'shared-event-key',
      title: 'Dedupe title',
      userId: firstSession.userId,
    })
    const second = await enqueuePushNotification(prisma, {
      body: 'Dedupe body',
      dedupeKey: 'shared-event-key',
      title: 'Dedupe title',
      userId: secondSession.userId,
    })

    expect(first.created).toBe(true)
    expect(duplicateFirst).toEqual({ created: false, id: first.id })
    expect(second.created).toBe(true)
    expect(second.id).not.toBe(first.id)
    expect(await prisma.pushNotificationOutbox.count()).toBe(2)
  })

  test('retryable receipt errors requeue only the affected token', async () => {
    const session = await registerUser('receipt-retry@example.com')
    const sentAt = new Date('2026-05-21T12:00:00.000Z')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[receipt-retry-token]',
        userId: session.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Receipt retry body',
      dedupeKey: 'receipt-retry-test',
      scheduledFor: sentAt,
      title: 'Receipt retry title',
      userId: session.userId,
    })
    const sendBodies: Array<Array<{ to: string }>> = []
    let receiptCalls = 0
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/push/send')) {
        const body = JSON.parse(String(init?.body)) as Array<{ to: string }>
        sendBodies.push(body)
        return json({
          data: [{ id: `receipt-ticket-${sendBodies.length}`, status: 'ok' }],
        })
      }

      receiptCalls += 1
      return json({
        data: {
          [`receipt-ticket-${receiptCalls}`]: {
            details: { error: 'MessageRateExceeded' },
            message: 'Rate exceeded',
            status: 'error',
          },
        },
      })
    }

    await processPushOutbox(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now: sentAt, onlyIds: [queued.id] },
    )
    const receiptMetrics = await checkPushReceipts(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now: new Date(sentAt.getTime() + 20_000) },
    )
    expect(receiptMetrics.failed).toBe(1)

    const pendingOutbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: {
        id: queued.id,
      },
    })
    expect(pendingOutbox.status).toBe(PushNotificationOutboxStatus.pending)
    expect(
      await prisma.pushDelivery.count({
        where: {
          outboxId: queued.id,
        },
      }),
    ).toBe(0)

    await processPushOutbox(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now: new Date(sentAt.getTime() + 3 * 60 * 1000), onlyIds: [queued.id] },
    )
    expect(sendBodies).toHaveLength(2)
    expect((sendBodies[1] ?? []).map((message) => message.to)).toEqual([
      'ExponentPushToken[receipt-retry-token]',
    ])
  })

  test('missing receipts back off before terminal stale failure', async () => {
    const session = await registerUser('missing-receipt@example.com')
    const sentAt = new Date('2026-05-21T12:00:00.000Z')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[missing-receipt-token]',
        userId: session.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Missing receipt body',
      dedupeKey: 'missing-receipt-test',
      scheduledFor: sentAt,
      title: 'Missing receipt title',
      userId: session.userId,
    })
    let receiptCalls = 0
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input)

      if (url.endsWith('/push/send')) {
        return json({
          data: [{ id: 'ticket-missing-receipt', status: 'ok' }],
        })
      }

      receiptCalls += 1
      return json({
        data: {},
      })
    }

    await processPushOutbox(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now: sentAt, onlyIds: [queued.id] },
    )

    const tooEarly = await checkPushReceipts(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now: new Date(sentAt.getTime() + 5_000) },
    )
    expect(tooEarly).toEqual({
      checked: 0,
      delivered: 0,
      failed: 0,
      tokensDisabled: 0,
    })
    expect(receiptCalls).toBe(0)

    const firstDue = new Date(sentAt.getTime() + 20_000)
    await checkPushReceipts({ env, prisma, pushClientOptions: { fetchImpl } }, { now: firstDue })
    expect(receiptCalls).toBe(1)

    let delivery = await prisma.pushDelivery.findFirstOrThrow({
      where: {
        outboxId: queued.id,
      },
    })
    expect(delivery.status).toBe(PushDeliveryStatus.sent)
    expect(delivery.receiptCheckAttempts).toBe(1)
    expect(delivery.receiptCheckedAt).toBeNull()
    expect(delivery.receiptNextCheckAt?.getTime()).toBeGreaterThan(firstDue.getTime())

    await checkPushReceipts({ env, prisma, pushClientOptions: { fetchImpl } }, { now: firstDue })
    expect(receiptCalls).toBe(1)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      delivery = await prisma.pushDelivery.findFirstOrThrow({
        where: {
          outboxId: queued.id,
        },
      })
      if (delivery.status === PushDeliveryStatus.failed) break

      await checkPushReceipts(
        { env, prisma, pushClientOptions: { fetchImpl } },
        { now: delivery.receiptNextCheckAt ?? new Date(firstDue.getTime() + 60_000) },
      )
    }

    delivery = await prisma.pushDelivery.findFirstOrThrow({
      where: {
        outboxId: queued.id,
      },
    })
    expect(delivery.status).toBe(PushDeliveryStatus.failed)
    expect(delivery.receiptCheckedAt).toBeInstanceOf(Date)
    expect(delivery.receiptNextCheckAt).toBeNull()
    expect(delivery.errorMessage).toBe('Expo push receipt was unavailable after repeated checks')
    expect(receiptCalls).toBeGreaterThan(1)
  })

  test('transient send failures requeue the outbox item for retry', async () => {
    const session = await registerUser('retry@example.com')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[retry-token]',
        userId: session.userId,
      },
    })
    const now = new Date('2026-05-21T12:00:00.000Z')
    const queued = await enqueuePushNotification(prisma, {
      body: 'Retry body',
      dedupeKey: 'retry-test',
      scheduledFor: now,
      title: 'Retry title',
      userId: session.userId,
    })

    const metrics = await processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () =>
            new Response('{}', {
              status: 429,
              statusText: 'Too Many Requests',
            }),
        },
      },
      { now, onlyIds: [queued.id] },
    )

    expect(metrics.transientFailed).toBe(1)
    const outbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: {
        id: queued.id,
      },
    })
    expect(outbox.status).toBe(PushNotificationOutboxStatus.pending)
    expect(outbox.attempts).toBe(1)
    expect(outbox.scheduledFor.getTime()).toBeGreaterThan(now.getTime())
  })

  test('outbox claim respects scheduled retry backoff after stale in-memory selection', async () => {
    const session = await registerUser('claim-backoff@example.com')
    const selectedAt = new Date('2026-05-21T12:00:00.000Z')
    const retryAt = new Date(selectedAt.getTime() + 2 * 60 * 1000)
    const queued = await enqueuePushNotification(prisma, {
      body: 'Backoff body',
      dedupeKey: 'claim-backoff-test',
      title: 'Backoff title',
      userId: session.userId,
    })

    await prisma.pushNotificationOutbox.update({
      where: {
        id: queued.id,
      },
      data: {
        scheduledFor: retryAt,
        status: PushNotificationOutboxStatus.pending,
      },
    })

    await expect(
      claimPushOutboxItemForProcessing(prisma, queued.id, selectedAt),
    ).resolves.toBe(false)

    let outbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: {
        id: queued.id,
      },
    })
    expect(outbox.status).toBe(PushNotificationOutboxStatus.pending)
    expect(outbox.scheduledFor).toEqual(retryAt)

    await expect(claimPushOutboxItemForProcessing(prisma, queued.id, retryAt)).resolves.toBe(true)

    outbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: {
        id: queued.id,
      },
    })
    expect(outbox.status).toBe(PushNotificationOutboxStatus.processing)
  })

  test('partial batch success stores tickets and retries only unsent tokens', async () => {
    const session = await registerUser('partial-batch@example.com')
    for (const index of Array.from({ length: 101 }, (_, value) => value)) {
      await prisma.pushToken.create({
        data: {
          expoPushToken: `ExponentPushToken[partial-${index}]`,
          userId: session.userId,
        },
      })
    }
    const now = new Date('2026-05-21T12:00:00.000Z')
    const queued = await enqueuePushNotification(prisma, {
      body: 'Partial batch body',
      dedupeKey: 'partial-batch-test',
      scheduledFor: now,
      title: 'Partial batch title',
      userId: session.userId,
    })
    const sendBodies: Array<Array<{ to: string }>> = []
    let sendCallCount = 0
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      sendCallCount += 1
      const body = JSON.parse(String(init?.body)) as Array<{ to: string }>
      sendBodies.push(body)

      if (sendCallCount === 2) {
        return new Response('{}', {
          status: 429,
          statusText: 'Too Many Requests',
        })
      }

      return json({
        data: body.map((_, index) => ({
          id: `ticket-${sendCallCount}-${index}`,
          status: 'ok',
        })),
      })
    }

    const firstPass = await processPushOutbox(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now, onlyIds: [queued.id] },
    )
    expect(firstPass.transientFailed).toBe(1)
    expect(sendBodies).toHaveLength(2)
    expect(sendBodies[0]).toHaveLength(100)
    expect(sendBodies[1]).toHaveLength(1)

    const sentAfterFirstPass = await prisma.pushDelivery.count({
      where: {
        outboxId: queued.id,
        status: PushDeliveryStatus.sent,
      },
    })
    expect(sentAfterFirstPass).toBe(100)

    const pendingOutbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: {
        id: queued.id,
      },
    })
    expect(pendingOutbox.status).toBe(PushNotificationOutboxStatus.pending)
    expect(pendingOutbox.attempts).toBe(1)

    const retryPass = await processPushOutbox(
      { env, prisma, pushClientOptions: { fetchImpl } },
      {
        now: new Date('2026-05-21T12:03:00.000Z'),
        onlyIds: [queued.id],
      },
    )
    expect(retryPass.sent).toBe(1)
    expect(sendBodies).toHaveLength(3)
    expect(sendBodies[2]).toHaveLength(1)

    const firstBatchTokens = new Set((sendBodies[0] ?? []).map((message) => message.to))
    expect((sendBodies[2] ?? []).some((message) => firstBatchTokens.has(message.to))).toBe(false)

    const allDeliveries = await prisma.pushDelivery.count({
      where: {
        outboxId: queued.id,
      },
    })
    expect(allDeliveries).toBe(101)

    const completedOutbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: {
        id: queued.id,
      },
    })
    expect(completedOutbox.status).toBe(PushNotificationOutboxStatus.sent)
    expect(completedOutbox.attempts).toBe(2)
  })

  test('retryable ticket errors requeue only failed ticket tokens', async () => {
    const session = await registerUser('ticket-retry@example.com')
    await prisma.pushToken.createMany({
      data: [
        {
          expoPushToken: 'ExponentPushToken[ticket-ok]',
          userId: session.userId,
        },
        {
          expoPushToken: 'ExponentPushToken[ticket-retry]',
          userId: session.userId,
        },
      ],
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Ticket retry body',
      dedupeKey: 'ticket-retry-test',
      title: 'Ticket retry title',
      userId: session.userId,
    })
    const sendBodies: Array<Array<{ to: string }>> = []
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Array<{ to: string }>
      sendBodies.push(body)

      if (sendBodies.length === 1) {
        return json({
          data: body.map((message) =>
            message.to === 'ExponentPushToken[ticket-retry]'
              ? {
                  details: { error: 'MessageRateExceeded' },
                  message: 'Rate exceeded',
                  status: 'error',
                }
              : {
                  id: 'ticket-ok',
                  status: 'ok',
                },
          ),
        })
      }

      return json({
        data: body.map((_, index) => ({
          id: `ticket-retry-${index}`,
          status: 'ok',
        })),
      })
    }

    const firstPass = await processPushOutbox(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { onlyIds: [queued.id] },
    )
    expect(firstPass.transientFailed).toBe(1)
    expect(
      await prisma.pushDelivery.count({
        where: {
          outboxId: queued.id,
          status: PushDeliveryStatus.sent,
        },
      }),
    ).toBe(1)

    await processPushOutbox(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now: new Date(Date.now() + 3 * 60 * 1000), onlyIds: [queued.id] },
    )
    expect(sendBodies).toHaveLength(2)
    expect((sendBodies[1] ?? []).map((message) => message.to)).toEqual([
      'ExponentPushToken[ticket-retry]',
    ])
  })

  test('processPushOutbox refreshes the processing heartbeat before later batches', async () => {
    const session = await registerUser('heartbeat@example.com')
    for (const index of Array.from({ length: 101 }, (_, value) => value)) {
      await prisma.pushToken.create({
        data: {
          expoPushToken: `ExponentPushToken[heartbeat-${index}]`,
          userId: session.userId,
        },
      })
    }
    const queued = await enqueuePushNotification(prisma, {
      body: 'Heartbeat body',
      dedupeKey: 'heartbeat-test',
      title: 'Heartbeat title',
      userId: session.userId,
    })
    const staleUpdatedAt = new Date('2026-01-01T00:00:00.000Z')
    let sendCallCount = 0
    let secondBatchHeartbeat: unknown = null
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      sendCallCount += 1
      const body = JSON.parse(String(init?.body)) as Array<{ to: string }>

      if (sendCallCount === 1) {
        await prisma.pushNotificationOutbox.update({
          where: {
            id: queued.id,
          },
          data: {
            updatedAt: staleUpdatedAt,
          },
        })
      }

      if (sendCallCount === 2) {
        const outbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
          where: {
            id: queued.id,
          },
          select: {
            updatedAt: true,
          },
        })
        secondBatchHeartbeat = outbox.updatedAt
      }

      return json({
        data: body.map((_, index) => ({
          id: `heartbeat-ticket-${sendCallCount}-${index}`,
          status: 'ok',
        })),
      })
    }

    const metrics = await processPushOutbox(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { onlyIds: [queued.id] },
    )

    expect(metrics.sent).toBe(1)
    expect(sendCallCount).toBe(2)
    if (!(secondBatchHeartbeat instanceof Date)) {
      throw new Error('Expected the second batch heartbeat to be recorded')
    }
    expect(secondBatchHeartbeat.getTime()).toBeGreaterThan(staleUpdatedAt.getTime())
  })

  test('DeviceNotRegistered disables the stale token', async () => {
    const session = await registerUser('dead-token@example.com')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[dead-token]',
        userId: session.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Dead token body',
      dedupeKey: 'dead-token-test',
      title: 'Dead token title',
      userId: session.userId,
    })

    await processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () =>
            json({
              data: [
                {
                  details: { error: 'DeviceNotRegistered' },
                  message: 'Device is not registered',
                  status: 'error',
                },
              ],
            }),
        },
      },
      { onlyIds: [queued.id] },
    )

    const disabled = await prisma.pushToken.findUniqueOrThrow({
      where: {
        expoPushToken: 'ExponentPushToken[dead-token]',
      },
    })
    expect(disabled.disabledAt).toBeInstanceOf(Date)

    const delivery = await prisma.pushDelivery.findFirstOrThrow({
      where: {
        outboxId: queued.id,
      },
    })
    expect(delivery.status).toBe(PushDeliveryStatus.failed)
    expect(delivery.providerErrorCode).toBe('DeviceNotRegistered')
  })

  async function registerUser(email: string) {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({
        email,
        password: 'password123',
      }),
    })
    const body = (await res.json()) as {
      accessToken: string
      user: {
        id: string
      }
    }

    expect(res.status).toBe(201)
    return {
      accessToken: body.accessToken,
      userId: body.user.id,
    }
  }
})

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
  })
}
