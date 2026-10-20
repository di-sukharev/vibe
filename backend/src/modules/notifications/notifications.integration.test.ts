import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { runBackgroundJob } from '../../jobs'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { PushDeliveryStatus, PushNotificationOutboxStatus } from '../../generated/prisma/enums'
import type { BackendRuntime } from '../../runtime'
import {
  checkPushReceipts,
  enqueuePushNotification,
  processPushOutbox,
  redactTerminalNotificationDataBatch,
} from './infrastructure/notification-operations'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; run bun run test:backend:integration')
const originalFetch = globalThis.fetch

describe('push notification API and outbox', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    ACCESS_TOKEN_TTL_SECONDS: '60',
    CORS_ORIGINS: 'http://localhost:5173',
    JWT_SECRET: '12345678901234567890123456789012',
  })
  const prisma = createPrisma(databaseUrl)
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
    const installationId = randomUUID()
    const installationSecret = randomUUID()

    const save = await app.request('/api/notifications/push-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: 'device-1',
        expoPushToken: 'ExponentPushToken[token-1]',
        generation: 1,
        installationId,
        installationSecret,
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
        generation: 1,
        installationId: randomUUID(),
        installationSecret: randomUUID(),
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
        expoPushTokens: ['ExponentPushToken[token-1]'],
        generation: 2,
        installationId,
        installationSecret,
      }),
    })
    expect(unregister.status).toBe(200)
    expect(await unregister.json()).toEqual({ applied: true, ok: true })
    expect(await prisma.pushToken.count()).toBe(0)
  })

  test('legacy push clients bind to the current session without overriding modern authority', async () => {
    const session = await registerUser('legacy-push-rollout@example.com')
    const legacyToken = 'ExponentPushToken[legacy-rollout]'

    const registration = await app.request('/api/notifications/push-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expoPushToken: legacyToken, platform: 'ios' }),
    })

    expect(registration.status).toBe(200)
    expect(await prisma.pushToken.findUniqueOrThrow({
      where: { expoPushToken: legacyToken },
      select: { installationId: true, registrationSessionId: true },
    })).toEqual({
      installationId: null,
      registrationSessionId: session.sessionId,
    })

    const removal = await app.request('/api/notifications/push-token/unregister', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expoPushToken: legacyToken }),
    })
    expect(removal.status).toBe(200)
    expect(await prisma.pushToken.findUnique({ where: { expoPushToken: legacyToken } })).toBeNull()
  })

  test('newer installation generations win across accounts and reject late mutations', async () => {
    const accountA = await registerUser('push-installation-a@example.com')
    const accountB = await registerUser('push-installation-b@example.com')
    const installationId = randomUUID()
    const installationSecret = randomUUID()
    const request = (
      accessToken: string,
      path: '/api/notifications/push-token' | '/api/notifications/push-token/unregister',
      body: Record<string, unknown>,
    ) => app.request(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    expect((await request(accountA.accessToken, '/api/notifications/push-token', {
      expoPushToken: 'ExponentPushToken[account-a-token]',
      generation: 1,
      installationId,
      installationSecret,
    })).status).toBe(200)

    expect((await request(accountB.accessToken, '/api/notifications/push-token', {
      expoPushToken: 'ExponentPushToken[account-b-token]',
      generation: 2,
      installationId,
      installationSecret,
      previousExpoPushTokens: ['ExponentPushToken[account-a-token]'],
    })).status).toBe(200)

    const lateA = await request(accountA.accessToken, '/api/notifications/push-token', {
      expoPushToken: 'ExponentPushToken[late-account-a-token]',
      generation: 1,
      installationId,
      installationSecret,
    })
    expect(lateA.status).toBe(409)

    const staleCleanup = await request(
      accountA.accessToken,
      '/api/notifications/push-token/unregister',
      {
        expoPushTokens: ['ExponentPushToken[account-b-token]'],
        generation: 1,
        installationId,
        installationSecret,
      },
    )
    expect(staleCleanup.status).toBe(200)
    expect(await staleCleanup.json()).toEqual({ applied: false, ok: true })

    const tokensAfterLateA = await prisma.pushToken.findMany({
      where: { installationId },
      select: {
        expoPushToken: true,
        registrationSessionId: true,
        userId: true,
      },
    })
    expect(tokensAfterLateA).toEqual([{
      expoPushToken: 'ExponentPushToken[account-b-token]',
      registrationSessionId: accountB.sessionId,
      userId: accountB.userId,
    }])

    expect((await request(accountB.accessToken, '/api/notifications/push-token', {
      expoPushToken: 'ExponentPushToken[account-b-rotated-token]',
      generation: 3,
      installationId,
      installationSecret,
      previousExpoPushTokens: ['ExponentPushToken[account-b-token]'],
    })).status).toBe(200)

    expect(await prisma.pushToken.findMany({
      where: { installationId },
      select: { expoPushToken: true, userId: true },
    })).toEqual([{
      expoPushToken: 'ExponentPushToken[account-b-rotated-token]',
      userId: accountB.userId,
    }])
  })

  test('a conflicting token claim quarantines delivery without stealing installation authority', async () => {
    const victim = await registerUser('push-installation-victim@example.com')
    const attacker = await registerUser('push-installation-attacker@example.com')
    const victimInstallationId = randomUUID()
    const victimSecret = randomUUID()
    const attackerInstallationId = randomUUID()
    const attackerSecret = randomUUID()
    const victimToken = 'ExponentPushToken[victim-token]'
    const register = (accessToken: string, body: Record<string, unknown>) =>
      app.request('/api/notifications/push-token', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

    expect((await register(victim.accessToken, {
      expoPushToken: victimToken,
      generation: 1,
      installationId: victimInstallationId,
      installationSecret: victimSecret,
    })).status).toBe(200)

    expect((await register(attacker.accessToken, {
      expoPushToken: 'ExponentPushToken[attacker-token]',
      generation: 1,
      installationId: attackerInstallationId,
      installationSecret: attackerSecret,
      previousExpoPushTokens: [victimToken],
    })).status).toBe(200)
    expect(await prisma.pushToken.findUnique({
      where: { expoPushToken: victimToken },
      select: { userId: true },
    })).toEqual({ userId: victim.userId })

    expect((await register(attacker.accessToken, {
      expoPushToken: victimToken,
      generation: 2,
      installationId: victimInstallationId,
      installationSecret: attackerSecret,
    })).status).toBe(403)

    const unregisterVictim = await app.request('/api/notifications/push-token/unregister', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${attacker.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expoPushTokens: [victimToken],
        generation: 2,
        installationId: attackerInstallationId,
        installationSecret: attackerSecret,
      }),
    })
    expect(unregisterVictim.status).toBe(200)
    expect(await prisma.pushToken.findUnique({
      where: { expoPushToken: victimToken },
      select: { userId: true },
    })).toEqual({ userId: victim.userId })

    const steal = await register(attacker.accessToken, {
      expoPushToken: victimToken,
      generation: 3,
      installationId: attackerInstallationId,
      installationSecret: attackerSecret,
    })
    expect(steal.status).toBe(403)
    expect(await prisma.pushToken.findUnique({
      where: { expoPushToken: victimToken },
      select: { disabledAt: true, installationId: true, userId: true },
    })).toEqual({
      disabledAt: expect.any(Date),
      installationId: victimInstallationId,
      userId: victim.userId,
    })

    expect((await register(victim.accessToken, {
      expoPushToken: victimToken,
      generation: 2,
      installationId: victimInstallationId,
      installationSecret: victimSecret,
    })).status).toBe(200)
    expect(await prisma.pushToken.findUnique({
      where: { expoPushToken: victimToken },
      select: { disabledAt: true, installationId: true, userId: true },
    })).toEqual({
      disabledAt: null,
      installationId: victimInstallationId,
      userId: victim.userId,
    })
  })

  test('the same account can reclaim an unchanged Expo token after installation storage resets', async () => {
    const session = await registerUser('push-installation-reset@example.com')
    const previousInstallationId = randomUUID()
    const nextInstallationId = randomUUID()
    const expoPushToken = 'ExponentPushToken[installation-reset-token]'
    const register = (body: Record<string, unknown>) =>
      app.request('/api/notifications/push-token', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

    expect((await register({
      expoPushToken,
      generation: 1,
      installationId: previousInstallationId,
      installationSecret: randomUUID(),
    })).status).toBe(200)
    expect((await register({
      expoPushToken,
      generation: 1,
      installationId: nextInstallationId,
      installationSecret: randomUUID(),
    })).status).toBe(200)

    expect(await prisma.pushToken.findUnique({
      where: { expoPushToken },
      select: { installationId: true, registrationSessionId: true, userId: true },
    })).toEqual({
      installationId: nextInstallationId,
      registrationSessionId: session.sessionId,
      userId: session.userId,
    })
    expect(await prisma.pushInstallation.findUnique({
      where: { id: previousInstallationId },
      select: { active: true },
    })).toEqual({ active: false })
    expect(await prisma.pushInstallation.findUnique({
      where: { id: nextInstallationId },
      select: { active: true },
    })).toEqual({ active: true })
  })

  test('an authorized installation can transfer an unchanged Expo token to a newer account generation', async () => {
    const accountA = await registerUser('push-same-token-transfer-a@example.com')
    const accountB = await registerUser('push-same-token-transfer-b@example.com')
    const installationId = randomUUID()
    const installationSecret = randomUUID()
    const expoPushToken = 'ExponentPushToken[same-installation-account-transfer]'
    const register = (accessToken: string, generation: number) =>
      app.request('/api/notifications/push-token', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expoPushToken,
          generation,
          installationId,
          installationSecret,
        }),
      })

    expect((await register(accountA.accessToken, 1)).status).toBe(200)
    expect((await register(accountB.accessToken, 2)).status).toBe(200)
    expect((await register(accountA.accessToken, 1)).status).toBe(409)

    expect(await prisma.pushToken.findUnique({
      where: { expoPushToken },
      select: { installationId: true, registrationSessionId: true, userId: true },
    })).toEqual({
      installationId,
      registrationSessionId: accountB.sessionId,
      userId: accountB.userId,
    })
    expect(await prisma.pushInstallation.findUniqueOrThrow({
      where: { id: installationId },
      select: { active: true, generation: true, ownerUserId: true },
    })).toEqual({
      active: true,
      generation: 2,
      ownerUserId: accountB.userId,
    })
  })

  test('bounds concurrent push-token registrations per user', async () => {
    const session = await registerUser('push-token-cap@example.com')
    const cappedApp = createApp({
      env: { ...env, PUSH_TOKEN_MAX_PER_USER: 2 },
      prisma,
    })

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        cappedApp.request('/api/notifications/push-token', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deviceId: `device-${index}`,
            expoPushToken: `ExponentPushToken[bounded-${index}]`,
            generation: 1,
            installationId: randomUUID(),
            installationSecret: randomUUID(),
            platform: index % 2 === 0 ? 'ios' : 'android',
          }),
        }),
      ),
    )

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(await prisma.pushToken.count({ where: { userId: session.userId } })).toBe(2)
  })

  test('disabled registrations cannot evict live devices from the account cap', async () => {
    const session = await registerUser('push-token-disabled-cap@example.com')
    const cappedApp = createApp({
      env: { ...env, PUSH_TOKEN_MAX_PER_USER: 2 },
      prisma,
    })
    const devices = ['dead', 'live', 'new'].map((label) => ({
      installationId: randomUUID(),
      installationSecret: randomUUID(),
      token: `ExponentPushToken[disabled-cap-${label}]`,
    }))
    const register = (device: (typeof devices)[number]) =>
      cappedApp.request('/api/notifications/push-token', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expoPushToken: device.token,
          generation: 1,
          installationId: device.installationId,
          installationSecret: device.installationSecret,
        }),
      })

    expect((await register(devices[0]!)).status).toBe(200)
    expect((await register(devices[1]!)).status).toBe(200)
    const queued = await enqueuePushNotification(prisma, {
      body: 'Disable one capped token',
      dedupeKey: 'disabled-cap-test',
      title: 'Cap interaction',
      userId: session.userId,
    })
    await processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async (_input, init) => {
            const body = JSON.parse(String(init?.body)) as Array<{ to: string }>
            return json({
              data: body.map((message) =>
                message.to === devices[0]!.token
                  ? {
                      details: { error: 'DeviceNotRegistered' },
                      message: 'Device is not registered',
                      status: 'error',
                    }
                  : { id: 'disabled-cap-live-ticket', status: 'ok' },
              ),
            })
          },
        },
      },
      { onlyIds: [queued.id] },
    )
    expect(await prisma.pushToken.findUniqueOrThrow({
      where: { expoPushToken: devices[0]!.token },
      select: { disabledAt: true },
    })).toEqual({ disabledAt: expect.any(Date) })

    expect((await register(devices[2]!)).status).toBe(200)

    expect(await prisma.pushToken.findMany({
      where: { userId: session.userId },
      orderBy: { expoPushToken: 'asc' },
      select: { disabledAt: true, expoPushToken: true },
    })).toEqual([
      { disabledAt: null, expoPushToken: devices[1]!.token },
      { disabledAt: null, expoPushToken: devices[2]!.token },
    ])
    expect(await prisma.pushInstallation.findUniqueOrThrow({
      where: { id: devices[0]!.installationId },
      select: { active: true },
    })).toEqual({ active: false })
  })

  test('an installation evicted by the account cap is restored on its next launch heartbeat', async () => {
    const session = await registerUser('push-token-cap-recovery@example.com')
    const cappedApp = createApp({
      env: { ...env, PUSH_TOKEN_MAX_PER_USER: 2 },
      prisma,
    })
    const devices = Array.from({ length: 3 }, (_, index) => ({
      installationId: randomUUID(),
      installationSecret: randomUUID(),
      token: `ExponentPushToken[cap-recovery-${index}]`,
    }))
    const register = (device: (typeof devices)[number], generation: number) =>
      cappedApp.request('/api/notifications/push-token', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expoPushToken: device.token,
          generation,
          installationId: device.installationId,
          installationSecret: device.installationSecret,
        }),
      })

    for (const device of devices) {
      expect((await register(device, 1)).status).toBe(200)
    }

    expect(await prisma.pushInstallation.findUniqueOrThrow({
      where: { id: devices[0]!.installationId },
      select: { active: true },
    })).toEqual({ active: false })
    const retainedBeforeReopen = await prisma.pushToken.findMany({
      where: { userId: session.userId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { expoPushToken: true },
    })
    expect(retainedBeforeReopen).toHaveLength(2)

    expect((await register(devices[0]!, 2)).status).toBe(200)

    expect(await prisma.pushToken.findMany({
      where: { userId: session.userId },
      orderBy: { expoPushToken: 'asc' },
      select: { expoPushToken: true },
    })).toEqual([
      { expoPushToken: devices[0]!.token },
      retainedBeforeReopen[0],
    ].sort((left, right) => left.expoPushToken.localeCompare(right.expoPushToken)))
    const evictedDevice = devices.find(
      (device) => device.token === retainedBeforeReopen[1]!.expoPushToken,
    )
    expect(evictedDevice).toBeDefined()
    expect(await prisma.pushInstallation.findUniqueOrThrow({
      where: { id: evictedDevice!.installationId },
      select: { active: true },
    })).toEqual({ active: false })
  })

  test('token logout removes its installation registration without a client token list', async () => {
    const session = await registerUser('push-token-empty-logout@example.com')
    const installationId = randomUUID()
    const installationSecret = randomUUID()
    const registration = await app.request('/api/notifications/push-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expoPushToken: 'ExponentPushToken[empty-logout-token]',
        generation: 1,
        installationId,
        installationSecret,
      }),
    })
    expect(registration.status).toBe(200)

    const logout = await app.request('/api/auth/token/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: session.refreshToken,
      }),
    })

    expect(logout.status).toBe(204)
    expect(await prisma.pushToken.count({
      where: {
        installationId,
        registrationSessionId: session.sessionId,
      },
    })).toBe(0)
  })

  test('notification writes carry an ingress body limit and their own per-address budget', async () => {
    // Production settings: a trusted proxy header and counters in PostgreSQL. The limits run
    // before authentication, so an anonymous flood never reaches the session lookup.
    await prisma.rateLimitBucket.deleteMany({ where: { policy: 'notifications' } })
    await prisma.rateLimitBucket.deleteMany({
      where: { key: '198.51.100.40', policy: { in: ['account', 'auth'] } },
    })
    const limitedApp = createApp({
      env: {
        ...env,
        AUTH_BODY_LIMIT_BYTES: 1024,
        AUTH_RATE_LIMIT_MAX: 2,
        RATE_LIMIT_STORE: 'database',
        TRUST_PROXY: true,
        TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-forwarded-for',
      },
      prisma,
    })
    const post = (path: string, body: unknown, clientIp = '198.51.100.40') =>
      limitedApp.request(`/api/notifications${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': clientIp },
        body: JSON.stringify(body),
      })

    expect((await post('/push-token', { deviceId: 'x'.repeat(2048) })).status).toBe(413)

    const registration = { expoPushToken: 'ExponentPushToken[ingress-budget]' }
    expect((await post('/push-token', registration)).status).toBe(401)
    expect((await post('/push-token/unregister', {})).status).toBe(401)
    const limited = await post('/test-push', {})
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await post('/push-token', registration, '198.51.100.41')).status).toBe(401)
    expect(await prisma.rateLimitBucket.count({ where: { policy: 'notifications' } })).toBeGreaterThan(0)

    // The spent notifications budget leaves the account and sign-in budgets of the same address.
    const sameAddress = { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.40' }
    expect((await limitedApp.request('/api/users/me', {
      method: 'PATCH',
      headers: sameAddress,
      body: JSON.stringify({}),
    })).status).toBe(401)
    expect((await limitedApp.request('/api/auth/token/login', {
      method: 'POST',
      headers: sameAddress,
      body: JSON.stringify({}),
    })).status).toBe(400)
  })

  test('keeps test push disabled by default and durably limits enabled requests', async () => {
    const disabled = await app.request('/api/notifications/test-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(disabled.status).toBe(404)

    const session = await registerUser('test-push-quota@example.com')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[test-push-quota]',
        registrationSessionId: session.sessionId,
        userId: session.userId,
      },
    })
    const enabledApp = createApp({
      env: { ...env, ENABLE_TEST_PUSH: true },
      prisma,
    })
    const request = () => enabledApp.request('/api/notifications/test-push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    const first = await request()
    const second = await request()

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect((await second.json()).error.code).toBe('RATE_LIMITED')
    expect(await prisma.pushNotificationOutbox.count()).toBe(1)
    expect(await prisma.pushNotificationOutbox.findFirst()).toMatchObject({
      status: PushNotificationOutboxStatus.pending,
    })
    expect(await prisma.pushDelivery.count()).toBe(0)
  })

  test('processPushOutbox sends tickets and checkPushReceipts marks delivery', async () => {
    const session = await registerUser('delivery@example.com')
    const sentAt = new Date('2026-05-21T12:00:00.000Z')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[delivery-token]',
        registrationSessionId: session.sessionId,
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
    expect(delivered.expoPushToken).toBeNull()
    expect(delivered.receiptNextCheckAt).toBeNull()
    const redactedOutbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: { id: queued.id },
    })
    expect(redactedOutbox).toMatchObject({
      body: '',
      data: null,
      title: '',
    })
  })

  test('does not deliver through expired-session or legacy unbound tokens', async () => {
    const session = await registerUser('expired-session-delivery@example.com')
    const absoluteExpired = await registerUser('absolute-expired-session-delivery@example.com')
    const now = new Date('2026-07-17T12:00:00.000Z')
    const expoPushToken = 'ExponentPushToken[expired-session-delivery]'
    await prisma.authSession.update({
      where: { id: session.sessionId },
      data: { expiresAt: new Date(now.getTime() - 1) },
    })
    await prisma.authSession.update({
      where: { id: absoluteExpired.sessionId },
      data: {
        createdAt: new Date(
          now.getTime() - (env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 + 1) * 1_000,
        ),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      },
    })
    await prisma.pushToken.create({
      data: {
        expoPushToken,
        registrationSessionId: session.sessionId,
        userId: session.userId,
      },
    })
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[legacy-unbound-delivery]',
        userId: session.userId,
      },
    })
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[absolute-expired-session-delivery]',
        registrationSessionId: absoluteExpired.sessionId,
        userId: absoluteExpired.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Must not be delivered',
      dedupeKey: 'expired-session-delivery',
      scheduledFor: now,
      title: 'Expired session',
      userId: session.userId,
    })
    const absoluteExpiredQueued = await enqueuePushNotification(prisma, {
      body: 'Must not be delivered',
      dedupeKey: 'absolute-expired-session-delivery',
      scheduledFor: now,
      title: 'Absolute-expired session',
      userId: absoluteExpired.userId,
    })
    let requests = 0

    const metrics = await processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () => {
            requests += 1
            return json({ data: [] })
          },
        },
      },
      { now, onlyIds: [queued.id, absoluteExpiredQueued.id] },
    )

    expect(requests).toBe(0)
    expect(metrics.skipped).toBe(2)
    expect(await prisma.pushDelivery.findFirst({ where: { outboxId: queued.id } }))
      .toMatchObject({ status: PushDeliveryStatus.skipped })
    expect(await prisma.pushDelivery.findFirst({
      where: { outboxId: absoluteExpiredQueued.id },
    })).toMatchObject({ status: PushDeliveryStatus.skipped })
  })

  test('lazily binds migrated legacy tokens before delivery', async () => {
    const session = await registerUser('legacy-token-rollout-delivery@example.com')
    const expoPushToken = 'ExponentPushToken[legacy-rollout-delivery]'
    await prisma.pushToken.create({
      data: { expoPushToken, userId: session.userId },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Compatible rollout delivery',
      dedupeKey: 'legacy-rollout-delivery',
      title: 'Legacy migration',
      userId: session.userId,
    })
    const delivery = { to: null as string | null }

    const metrics = await processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async (_input, init) => {
            const [message] = JSON.parse(String(init?.body)) as Array<{ to: string }>
            delivery.to = message?.to ?? null
            return json({ data: [{ id: 'legacy-rollout-ticket', status: 'ok' }] })
          },
        },
      },
      { onlyIds: [queued.id] },
    )

    expect(metrics.sent).toBe(1)
    if (!delivery.to) throw new Error('Expected the migrated token to be delivered')
    expect(delivery.to).toBe(expoPushToken)
    expect(await prisma.pushToken.findUniqueOrThrow({
      where: { expoPushToken },
      select: { registrationSessionId: true },
    })).toEqual({ registrationSessionId: session.sessionId })
  })

  test('session maintenance removes expired, revoked, and orphaned session-bound tokens', async () => {
    const expired = await registerUser('expired-session-cleanup@example.com')
    const revoked = await registerUser('revoked-session-cleanup@example.com')
    const absoluteExpired = await registerUser('absolute-expired-session-cleanup@example.com')
    const active = await registerUser('active-session-cleanup@example.com')
    const now = new Date()
    await prisma.authSession.update({
      where: { id: expired.sessionId },
      data: { expiresAt: new Date(now.getTime() - 1) },
    })
    await prisma.authSession.update({
      where: { id: revoked.sessionId },
      data: { revokedAt: now },
    })
    await prisma.authSession.update({
      where: { id: absoluteExpired.sessionId },
      data: {
        createdAt: new Date(
          now.getTime() - (env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 + 1) * 1_000,
        ),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      },
    })
    await prisma.pushToken.createMany({
      data: [
        {
          expoPushToken: 'ExponentPushToken[expired-session-cleanup]',
          registrationSessionId: expired.sessionId,
          userId: expired.userId,
        },
        {
          expoPushToken: 'ExponentPushToken[revoked-session-cleanup]',
          registrationSessionId: revoked.sessionId,
          userId: revoked.userId,
        },
        {
          expoPushToken: 'ExponentPushToken[absolute-expired-session-cleanup]',
          registrationSessionId: absoluteExpired.sessionId,
          userId: absoluteExpired.userId,
        },
        {
          expoPushToken: 'ExponentPushToken[active-session-cleanup]',
          registrationSessionId: active.sessionId,
          userId: active.userId,
        },
        {
          expoPushToken: 'ExponentPushToken[orphaned-session-cleanup]',
          registrationSessionId: randomUUID(),
          userId: active.userId,
        },
        {
          expoPushToken: 'ExponentPushToken[cross-user-session-cleanup]',
          registrationSessionId: active.sessionId,
          userId: expired.userId,
        },
        {
          expoPushToken: 'ExponentPushToken[legacy-session-cleanup]',
          userId: active.userId,
        },
      ],
    })

    await runBackgroundJob(
      'auth:sessions:cleanup',
      { env, prisma } as BackendRuntime,
      now,
    )

    expect(await prisma.pushToken.findMany({
      orderBy: { expoPushToken: 'asc' },
      select: { expoPushToken: true },
    })).toEqual([
      { expoPushToken: 'ExponentPushToken[active-session-cleanup]' },
      { expoPushToken: 'ExponentPushToken[legacy-session-cleanup]' },
    ])
    expect(await prisma.pushToken.findUniqueOrThrow({
      where: { expoPushToken: 'ExponentPushToken[legacy-session-cleanup]' },
      select: { registrationSessionId: true },
    })).toEqual({ registrationSessionId: active.sessionId })
  })

  test('maintenance redacts legacy terminal notification data in bounded batches', async () => {
    const session = await registerUser('notification-retention@example.com')
    const createTerminal = async (suffix: string, createdAt: Date) => {
      return prisma.pushNotificationOutbox.create({
        data: {
          body: `Sensitive body ${suffix}`,
          createdAt,
          data: { href: `/details/${suffix}` },
          dedupeKey: `legacy-terminal-${suffix}`,
          processedAt: createdAt,
          scheduledFor: createdAt,
          status: PushNotificationOutboxStatus.sent,
          title: `Sensitive title ${suffix}`,
          userId: session.userId,
          deliveries: {
            create: {
              expoPushToken: `ExponentPushToken[legacy-${suffix}]`,
              status: PushDeliveryStatus.delivered,
              userId: session.userId,
            },
          },
        },
      })
    }
    const first = await createTerminal('first', new Date('2026-01-01T00:00:00.000Z'))
    const second = await createTerminal('second', new Date('2026-01-02T00:00:00.000Z'))
    const pending = await prisma.pushNotificationOutbox.create({
      data: {
        body: 'Pending body',
        data: { href: '/details/pending' },
        dedupeKey: 'pending-retention',
        status: PushNotificationOutboxStatus.pending,
        title: 'Pending title',
        userId: session.userId,
      },
    })

    expect(await redactTerminalNotificationDataBatch(prisma, { limit: 1 })).toBe(1)
    expect(await prisma.pushNotificationOutbox.findUniqueOrThrow({ where: { id: first.id } }))
      .toMatchObject({ body: '', data: null, title: '' })
    expect(await prisma.pushDelivery.findFirstOrThrow({ where: { outboxId: first.id } }))
      .toMatchObject({ expoPushToken: null })
    expect(await prisma.pushNotificationOutbox.findUniqueOrThrow({ where: { id: second.id } }))
      .toMatchObject({ body: 'Sensitive body second', title: 'Sensitive title second' })
    expect(await prisma.pushNotificationOutbox.findUniqueOrThrow({ where: { id: pending.id } }))
      .toMatchObject({ body: 'Pending body', title: 'Pending title' })

    expect(await redactTerminalNotificationDataBatch(prisma, { limit: 10 })).toBe(1)
    expect(await redactTerminalNotificationDataBatch(prisma, { limit: 10 })).toBe(0)
  })

  test('claims each Expo receipt once across concurrent workers', async () => {
    const session = await registerUser('receipt-lease@example.com')
    const now = new Date('2026-05-21T12:00:00.000Z')
    const queued = await enqueuePushNotification(prisma, {
      body: 'Receipt lease body',
      dedupeKey: 'receipt-lease-test',
      title: 'Receipt lease title',
      userId: session.userId,
    })
    await prisma.pushDelivery.create({
      data: {
        outboxId: queued.id,
        receiptNextCheckAt: now,
        status: PushDeliveryStatus.sent,
        ticketId: 'ticket-receipt-lease',
        userId: session.userId,
      },
    })
    let receiptRequests = 0
    const fetchImpl = async () => {
      receiptRequests += 1
      return json({ data: { 'ticket-receipt-lease': { status: 'ok' } } })
    }

    const metrics = await Promise.all([
      checkPushReceipts({ env, prisma, pushClientOptions: { fetchImpl } }, { now }),
      checkPushReceipts({ env, prisma, pushClientOptions: { fetchImpl } }, { now }),
    ])

    expect(receiptRequests).toBe(1)
    expect(metrics.reduce((sum, item) => sum + item.delivered, 0)).toBe(1)
    expect(await prisma.pushDelivery.findFirst()).toMatchObject({
      receiptClaimToken: null,
      receiptClaimedAt: null,
      status: PushDeliveryStatus.delivered,
    })
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
        registrationSessionId: session.sessionId,
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

  test('transient send failures requeue the outbox item for retry', async () => {
    const session = await registerUser('retry@example.com')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[retry-token]',
        registrationSessionId: session.sessionId,
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

  test('worker shutdown requeues an interrupted send without consuming retry budget', async () => {
    const session = await registerUser('shutdown-retry@example.com')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[shutdown-token]',
        registrationSessionId: session.sessionId,
        userId: session.userId,
      },
    })
    const now = new Date('2026-05-21T12:00:00.000Z')
    const queued = await enqueuePushNotification(prisma, {
      body: 'Shutdown body',
      dedupeKey: 'shutdown-retry-test',
      scheduledFor: now,
      title: 'Shutdown title',
      userId: session.userId,
    })
    const controller = new AbortController()

    const metrics = await processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('worker stopped')))
              controller.abort()
            }),
        },
      },
      { now, onlyIds: [queued.id], signal: controller.signal },
    )

    expect(metrics.transientFailed).toBe(1)
    const outbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: { id: queued.id },
    })
    expect(outbox.status).toBe(PushNotificationOutboxStatus.pending)
    expect(outbox.attempts).toBe(0)
    expect(outbox.processingToken).toBeNull()
    expect(outbox.scheduledFor).toEqual(now)
  })

  test('worker shutdown persists a provider ticket that already succeeded before abort observation', async () => {
    const session = await registerUser('shutdown-after-ticket@example.com')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[shutdown-after-ticket]',
        registrationSessionId: session.sessionId,
        userId: session.userId,
      },
    })
    const now = new Date()
    const queued = await enqueuePushNotification(prisma, {
      body: 'Successful before shutdown',
      dedupeKey: 'shutdown-after-ticket',
      scheduledFor: now,
      title: 'Shutdown after ticket',
      userId: session.userId,
    })
    const controller = new AbortController()

    const metrics = await processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () => {
            controller.abort()
            return json({ data: [{ id: 'shutdown-after-ticket-id', status: 'ok' }] })
          },
        },
      },
      { now, onlyIds: [queued.id], signal: controller.signal },
    )

    expect(metrics.sent).toBe(1)
    expect(await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: { id: queued.id },
      select: { processingToken: true, status: true },
    })).toEqual({
      processingToken: null,
      status: PushNotificationOutboxStatus.sent,
    })
    expect(await prisma.pushDelivery.findFirstOrThrow({
      where: { outboxId: queued.id },
      select: { status: true, ticketId: true },
    })).toEqual({
      status: PushDeliveryStatus.sent,
      ticketId: 'shutdown-after-ticket-id',
    })
  })



  test('retryable ticket errors requeue only failed ticket tokens', async () => {
    const session = await registerUser('ticket-retry@example.com')
    await prisma.pushToken.createMany({
      data: [
        {
          expoPushToken: 'ExponentPushToken[ticket-ok]',
          registrationSessionId: session.sessionId,
          userId: session.userId,
        },
        {
          expoPushToken: 'ExponentPushToken[ticket-retry]',
          registrationSessionId: session.sessionId,
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

  test('DeviceNotRegistered disables the stale token', async () => {
    const session = await registerUser('dead-token@example.com')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[dead-token]',
        registrationSessionId: session.sessionId,
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
    expect(delivery.expoPushToken).toBeNull()
    expect(delivery.providerErrorCode).toBe('DeviceNotRegistered')
    expect(await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: { id: queued.id },
    })).toMatchObject({
      body: '',
      data: null,
      title: '',
    })
  })

  test('a delayed DeviceNotRegistered receipt cannot disable a newer installation generation', async () => {
    const session = await registerUser('late-dead-token-generation@example.com')
    const expoPushToken = 'ExponentPushToken[late-dead-token-generation]'
    const installationId = randomUUID()
    const installationSecret = randomUUID()
    const register = (generation: number) => app.request('/api/notifications/push-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expoPushToken,
        generation,
        installationId,
        installationSecret,
      }),
    })
    expect((await register(1)).status).toBe(200)
    const queued = await enqueuePushNotification(prisma, {
      body: 'Generation one delivery',
      dedupeKey: 'late-dead-token-generation',
      title: 'Generation snapshot',
      userId: session.userId,
    })
    await processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () => json({
            data: [{ id: 'late-generation-ticket', status: 'ok' }],
          }),
        },
      },
      { onlyIds: [queued.id] },
    )

    expect((await register(2)).status).toBe(200)
    await checkPushReceipts(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () => json({
            data: {
              'late-generation-ticket': {
                details: { error: 'DeviceNotRegistered' },
                message: 'Old delivery is no longer registered',
                status: 'error',
              },
            },
          }),
        },
      },
      { now: new Date(Date.now() + 20 * 60 * 1000) },
    )

    expect(await prisma.pushToken.findUniqueOrThrow({
      where: { expoPushToken },
      select: { disabledAt: true },
    })).toEqual({ disabledAt: null })
  })

  async function registerUser(email: string) {
    const res = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: 'password123',
      }),
    })
    const body = (await res.json()) as {
      accessToken: string
      refreshToken: string
      user: {
        id: string
      }
    }

    expect(res.status).toBe(201)
    return {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      sessionId: (await prisma.authSession.findFirstOrThrow({
        where: { userId: body.user.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })).id,
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
