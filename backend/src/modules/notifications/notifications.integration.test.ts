import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { runCronTask } from '../../cron'
import { acquirePushTokenUserLock, createPrisma, type DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { PushDeliveryStatus, PushNotificationOutboxStatus } from '../../generated/prisma/enums'
import type { BackendRuntime } from '../../runtime'
import {
  checkPushReceipts,
  claimPushOutboxItemForProcessing,
  enqueuePushNotification,
  processPushOutbox,
  redactTerminalNotificationDataBatch,
  registerPushToken,
  requeueRetryableReceipt,
} from './infrastructure/notification-operations'

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
    REFRESH_REUSE_GRACE_SECONDS: 10,
    SESSION_ABSOLUTE_TTL_DAYS: 90,
    SESSION_RETENTION_DAYS: 7,
    AUTH_BODY_LIMIT_BYTES: 64 * 1024,
    AUTH_RATE_LIMIT_MAX: 60,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    IAP_BODY_LIMIT_BYTES: 64 * 1024,
    IAP_RATE_LIMIT_MAX: 60,
    IAP_RATE_LIMIT_WINDOW_SECONDS: 60,
    SHUTDOWN_GRACE_SECONDS: 20,
    TRUST_PROXY: false,
    COOKIE_SECURE: false,
    ENABLE_TEST_PUSH: false,
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

  test('serializes push registration with terminal session revocation', async () => {
    const session = await registerUser('push-registration-revocation-race@example.com')
    const rotated = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    })
    expect(rotated.status).toBe(200)
    await prisma.authSession.update({
      where: { id: session.sessionId },
      data: { refreshRotatedAt: new Date(Date.now() - 60_000) },
    })
    const installationId = randomUUID()
    const expoPushToken = 'ExponentPushToken[registration-revocation-race]'
    let markSessionChecked: () => void = () => undefined
    const sessionChecked = new Promise<void>((resolve) => {
      markSessionChecked = resolve
    })
    let releaseRegistration: () => void = () => undefined
    const registrationBarrier = new Promise<void>((resolve) => {
      releaseRegistration = resolve
    })
    const registrationPrisma = prisma.$extends({
      query: {
        authSession: {
          async count({ args, query }) {
            const count = await query(args)
            if (args.where?.id === session.sessionId) {
              markSessionChecked()
              await registrationBarrier
            }
            return count
          },
        },
      },
    }) as unknown as DbClient

    const registration = registerPushToken(
      registrationPrisma,
      session.userId,
      session.sessionId,
      {
        expoPushToken,
        generation: 1,
        installationId,
        installationSecret: randomUUID(),
      },
      new Date(),
    )
    await sessionChecked

    let revocationSettled = false
    const revocation = Promise.resolve(
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }),
    ).finally(() => {
      revocationSettled = true
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expect(revocationSettled).toBe(false)

    releaseRegistration()
    expect(await registration).toBe('applied')
    expect((await revocation).status).toBe(401)
    expect(await prisma.pushToken.findUnique({ where: { expoPushToken } })).toBeNull()
  })

  test('serializes role changes with an in-flight push registration', async () => {
    const admin = await registerUser('push-role-registration-admin@example.com')
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    })
    const target = await registerUser('push-role-registration-target@example.com')
    const installationId = randomUUID()
    const expoPushToken = 'ExponentPushToken[role-registration-race]'
    let markSessionChecked: () => void = () => undefined
    const sessionChecked = new Promise<void>((resolve) => {
      markSessionChecked = resolve
    })
    let releaseRegistration: () => void = () => undefined
    const registrationBarrier = new Promise<void>((resolve) => {
      releaseRegistration = resolve
    })
    const registrationPrisma = prisma.$extends({
      query: {
        authSession: {
          async count({ args, query }) {
            const count = await query(args)
            if (args.where?.id === target.sessionId) {
              markSessionChecked()
              await registrationBarrier
            }
            return count
          },
        },
      },
    }) as unknown as DbClient
    const registration = registerPushToken(
      registrationPrisma,
      target.userId,
      target.sessionId,
      {
        expoPushToken,
        generation: 1,
        installationId,
        installationSecret: randomUUID(),
      },
      new Date(),
    )
    await sessionChecked

    let roleChangeSettled = false
    const roleChange = Promise.resolve(app.request(
      `/api/admin/users/${target.userId}/role`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${admin.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'admin' }),
      },
    )).finally(() => {
      roleChangeSettled = true
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    const roleChangeSettledBeforeRegistration = roleChangeSettled
    releaseRegistration()
    expect(await registration).toBe('applied')
    expect((await roleChange).status).toBe(200)
    expect(roleChangeSettledBeforeRegistration).toBe(false)
    expect(await prisma.pushToken.findUnique({ where: { expoPushToken } })).toBeNull()
    expect(await prisma.authSession.findUniqueOrThrow({
      where: { id: target.sessionId },
      select: { revokedAt: true },
    })).toEqual({ revokedAt: expect.any(Date) })
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

  test('the legacy owner can bind installation authority before a safe account transfer', async () => {
    const accountA = await registerUser('push-legacy-owner@example.com')
    const accountB = await registerUser('push-legacy-next-account@example.com')
    const installationId = randomUUID()
    const installationSecret = randomUUID()
    const legacyToken = 'ExponentPushToken[legacy-owner-token]'
    await prisma.pushToken.create({
      data: {
        expoPushToken: legacyToken,
        userId: accountA.userId,
      },
    })
    const register = (accessToken: string, body: Record<string, unknown>) =>
      app.request('/api/notifications/push-token', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

    expect((await register(accountA.accessToken, {
      expoPushToken: legacyToken,
      generation: 1,
      installationId,
      installationSecret,
    })).status).toBe(200)
    expect((await register(accountB.accessToken, {
      expoPushToken: 'ExponentPushToken[legacy-next-account-token]',
      generation: 2,
      installationId,
      installationSecret,
      previousExpoPushTokens: [legacyToken],
    })).status).toBe(200)

    expect(await prisma.pushToken.findMany({
      where: { installationId },
      select: { expoPushToken: true, userId: true },
    })).toEqual([{
      expoPushToken: 'ExponentPushToken[legacy-next-account-token]',
      userId: accountB.userId,
    }])
    expect(await prisma.pushToken.findUnique({
      where: { expoPushToken: legacyToken },
    })).toBeNull()
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

  test('serializes push registration authorization with logout cleanup', async () => {
    const session = await registerUser('push-token-logout-race@example.com')
    const authSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: session.userId },
      select: { id: true },
    })
    let releaseLogout: (() => void) | undefined
    let markLogoutLocked: (() => void) | undefined
    const logoutLocked = new Promise<void>((resolve) => {
      markLogoutLocked = resolve
    })
    const logout = prisma.$transaction(async (tx) => {
      await acquirePushTokenUserLock(tx, session.userId)
      markLogoutLocked?.()
      await new Promise<void>((resolve) => {
        releaseLogout = resolve
      })
      await tx.pushToken.deleteMany({ where: { userId: session.userId } })
      await tx.authSession.update({
        where: { id: authSession.id },
        data: { revokedAt: new Date() },
      })
    })
    await logoutLocked

    const registration = registerPushToken(
      prisma,
      session.userId,
      authSession.id,
      {
        expoPushToken: 'ExponentPushToken[late-after-logout]',
        generation: 1,
        installationId: randomUUID(),
        installationSecret: randomUUID(),
      },
      new Date(),
    )
    releaseLogout?.()
    await logout

    expect(await registration).toBe('inactive-session')
    expect(await prisma.pushToken.count({ where: { userId: session.userId } })).toBe(0)
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

  test('does not reclaim an outbox lease while another worker is inside the authorized Expo send', async () => {
    const session = await registerUser('delivery-send-lease@example.com')
    const startedAt = new Date()
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[send-lease]',
        registrationSessionId: session.sessionId,
        userId: session.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Send once',
      dedupeKey: 'send-lease',
      scheduledFor: startedAt,
      title: 'Send lease',
      userId: session.userId,
    })
    let releaseFirstSend: (() => void) | undefined
    let markFirstSendStarted: (() => void) | undefined
    const firstSendStarted = new Promise<void>((resolve) => {
      markFirstSendStarted = resolve
    })
    const firstSendBarrier = new Promise<void>((resolve) => {
      releaseFirstSend = resolve
    })
    const providerCalls: string[] = []
    const fetchImpl = async () => {
      const worker = providerCalls.length === 0 ? 'A' : 'B'
      providerCalls.push(worker)
      if (worker === 'A') {
        markFirstSendStarted?.()
        await firstSendBarrier
      }
      return json({ data: [{ id: `ticket-${worker}`, status: 'ok' }] })
    }
    const context = { env, prisma, pushClientOptions: { fetchImpl } }

    const workerA = processPushOutbox(context, {
      now: startedAt,
      onlyIds: [queued.id],
      processingStaleMs: 60_000,
    })
    await firstSendStarted

    const workerB = processPushOutbox(context, {
      now: new Date(Date.now() + 60_001),
      onlyIds: [queued.id],
      processingStaleMs: 60_000,
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    releaseFirstSend?.()
    await Promise.all([workerA, workerB])

    expect(providerCalls).toEqual(['A'])
    expect(await prisma.pushDelivery.findMany({
      where: { outboxId: queued.id },
      select: { ticketId: true },
    })).toEqual([{ ticketId: 'ticket-A' }])
  })

  test('does not start an Expo send after lock contention consumes the lease-safe deadline', async () => {
    const session = await registerUser('delivery-send-deadline@example.com')
    const startedAt = new Date()
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[send-deadline]',
        registrationSessionId: session.sessionId,
        userId: session.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Do not send after deadline',
      dedupeKey: 'send-deadline',
      scheduledFor: startedAt,
      title: 'Send deadline',
      userId: session.userId,
    })
    let releaseUserLock: (() => void) | undefined
    let markUserLockHeld: (() => void) | undefined
    const userLockHeld = new Promise<void>((resolve) => {
      markUserLockHeld = resolve
    })
    const userLockBarrier = new Promise<void>((resolve) => {
      releaseUserLock = resolve
    })
    const lockOwner = prisma.$transaction(async (tx) => {
      await acquirePushTokenUserLock(tx, session.userId)
      markUserLockHeld?.()
      await userLockBarrier
    })
    await userLockHeld
    let providerCalls = 0
    let markSendTransactionStarted: () => void = () => undefined
    const sendTransactionStarted = new Promise<void>((resolve) => {
      markSendTransactionStarted = resolve
    })
    let transactionCalls = 0
    const deadlinePrisma = new Proxy(prisma, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (typeof value !== 'function') return value
        const bound = value.bind(target)
        if (property !== '$transaction') return bound

        return new Proxy(bound, {
          apply(method, thisArg, args) {
            transactionCalls += 1
            const callback = args[0]
            if (transactionCalls !== 2 || typeof callback !== 'function') {
              return Reflect.apply(method, thisArg, args)
            }
            const wrappedArgs = [...args]
            wrappedArgs[0] = async (tx: unknown) => {
              markSendTransactionStarted()
              return Reflect.apply(callback, undefined, [tx])
            }
            return Reflect.apply(method, thisArg, wrappedArgs)
          },
        })
      },
    }) as DbClient

    const worker = processPushOutbox(
      {
        env,
        prisma: deadlinePrisma,
        pushClientOptions: {
          fetchImpl: async () => {
            providerCalls += 1
            return json({ data: [{ id: 'ticket-too-late', status: 'ok' }] })
          },
          requestTimeoutMs: 20,
        },
      },
      {
        now: startedAt,
        onlyIds: [queued.id],
        processingStaleMs: 40,
      },
    )

    await sendTransactionStarted
    await new Promise<void>((resolve) => setTimeout(resolve, 75))
    releaseUserLock?.()
    await lockOwner
    const metrics = await worker

    expect(providerCalls).toBe(0)
    expect(metrics.processed).toBe(1)
    expect(metrics.failed).toBe(1)
    expect(await prisma.pushDelivery.count({ where: { outboxId: queued.id } })).toBe(0)
    expect(await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: { id: queued.id },
      select: { processingToken: true },
    })).toEqual({ processingToken: null })
  })

  test('rechecks delivery authority after a terminal revocation wins the initial token snapshot race', async () => {
    const session = await registerUser('delivery-revoked-after-snapshot@example.com')
    const now = new Date()
    const expoPushToken = 'ExponentPushToken[revoked-after-snapshot]'
    await prisma.pushToken.create({
      data: {
        expoPushToken,
        registrationSessionId: session.sessionId,
        userId: session.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Must not be delivered after revocation',
      dedupeKey: 'revoked-after-snapshot',
      scheduledFor: now,
      title: 'Revoked after snapshot',
      userId: session.userId,
    })
    let markSnapshotSelected: () => void = () => undefined
    const snapshotSelected = new Promise<void>((resolve) => {
      markSnapshotSelected = resolve
    })
    let releaseSnapshot: () => void = () => undefined
    const snapshotBarrier = new Promise<void>((resolve) => {
      releaseSnapshot = resolve
    })
    let firstTokenSnapshot = true
    const workerPrisma = prisma.$extends({
      query: {
        pushToken: {
          async findMany({ args, query }) {
            const tokens = await query(args)
            if (firstTokenSnapshot && args.where?.userId === session.userId) {
              firstTokenSnapshot = false
              markSnapshotSelected()
              await snapshotBarrier
            }
            return tokens
          },
        },
      },
    }) as unknown as DbClient
    let requests = 0
    const worker = processPushOutbox(
      {
        env,
        prisma: workerPrisma,
        pushClientOptions: {
          fetchImpl: async () => {
            requests += 1
            return json({ data: [{ id: 'must-not-send', status: 'ok' }] })
          },
        },
      },
      { now, onlyIds: [queued.id] },
    )
    await snapshotSelected

    let logout: Response
    try {
      logout = await app.request('/api/auth/token/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      })
    } finally {
      releaseSnapshot()
    }
    const metrics = await worker

    expect(logout.status).toBe(204)
    expect(requests).toBe(0)
    expect(metrics.skipped).toBe(1)
    expect(await prisma.pushToken.findUnique({ where: { expoPushToken } })).toBeNull()
  })

  test('terminal revocation cannot return while an admitted Expo send is still in flight', async () => {
    const session = await registerUser('delivery-inflight-revocation@example.com')
    const now = new Date()
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[inflight-revocation]',
        registrationSessionId: session.sessionId,
        userId: session.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Admitted before logout',
      dedupeKey: 'inflight-revocation',
      scheduledFor: now,
      title: 'In-flight revocation',
      userId: session.userId,
    })
    const events: string[] = []
    let markSendStarted: () => void = () => undefined
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve
    })
    let releaseSend: () => void = () => undefined
    const sendBarrier = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    const worker = processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () => {
            events.push('send-started')
            markSendStarted()
            await sendBarrier
            events.push('send-finished')
            return json({ data: [{ id: 'inflight-revocation-ticket', status: 'ok' }] })
          },
        },
      },
      { now, onlyIds: [queued.id] },
    )
    await sendStarted

    let logoutSettled = false
    const logout = Promise.resolve(app.request('/api/auth/token/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    })).then((response) => {
      logoutSettled = true
      events.push('logout-returned')
      return response
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    const logoutSettledBeforeSend = logoutSettled
    releaseSend()
    const [metrics, logoutResponse] = await Promise.all([worker, logout])

    expect(logoutSettledBeforeSend).toBe(false)
    expect(logoutResponse.status).toBe(204)
    expect(metrics.sent).toBe(1)
    expect(events).toEqual(['send-started', 'send-finished', 'logout-returned'])
  })

  test('role changes wait for an admitted Expo send before revoking delivery authority', async () => {
    const admin = await registerUser('push-role-send-admin@example.com')
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    })
    const target = await registerUser('push-role-send-target@example.com')
    const independentTarget = await prisma.user.create({
      data: {
        email: 'push-role-independent-target@example.com',
        passwordHash: null,
        role: 'user',
      },
      select: { id: true },
    })
    const now = new Date()
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[role-send-race]',
        registrationSessionId: target.sessionId,
        userId: target.userId,
      },
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Admitted before the role change',
      dedupeKey: 'role-send-race',
      scheduledFor: now,
      title: 'Role send race',
      userId: target.userId,
    })
    let markSendStarted: () => void = () => undefined
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve
    })
    let releaseSend: () => void = () => undefined
    const sendBarrier = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    const worker = processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () => {
            markSendStarted()
            await sendBarrier
            return json({ data: [{ id: 'role-send-ticket', status: 'ok' }] })
          },
        },
      },
      { now, onlyIds: [queued.id] },
    )
    await sendStarted

    let roleChangeSettled = false
    const roleChange = Promise.resolve(app.request(
      `/api/admin/users/${target.userId}/role`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${admin.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'admin' }),
      },
    )).finally(() => {
      roleChangeSettled = true
    })
    const contentionStartedAt = Date.now()
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    const independentRoleChange = app.request(
      `/api/admin/users/${independentTarget.id}/role`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${admin.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'admin' }),
      },
    )
    const independentResponseBeforeRelease = await Promise.race([
      independentRoleChange,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
    ])
    const remainingContentionMs = Math.max(
      0,
      5_250 - (Date.now() - contentionStartedAt),
    )
    await new Promise<void>((resolve) => setTimeout(resolve, remainingContentionMs))
    const roleChangeSettledBeforeSend = roleChangeSettled
    const contentionElapsedMs = Date.now() - contentionStartedAt
    releaseSend()
    const [metrics, roleChangeResponse, independentResponse] = await Promise.all([
      worker,
      roleChange,
      independentRoleChange,
    ])
    expect(contentionElapsedMs).toBeGreaterThanOrEqual(5_000)
    expect(roleChangeSettledBeforeSend).toBe(false)
    expect(independentResponseBeforeRelease?.status).toBe(200)
    expect(metrics.sent).toBe(1)
    expect(roleChangeResponse.status).toBe(200)
    expect(independentResponse.status).toBe(200)
    expect(await prisma.pushToken.count({ where: { userId: target.userId } })).toBe(0)
  }, 15_000)

  test('same-token account transfer waits for an admitted send and fences the previous generation', async () => {
    const accountA = await registerUser('delivery-transfer-a@example.com')
    const accountB = await registerUser('delivery-transfer-b@example.com')
    const now = new Date()
    const installationId = randomUUID()
    const installationSecret = randomUUID()
    const expoPushToken = 'ExponentPushToken[inflight-account-transfer]'
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
    const queued = await enqueuePushNotification(prisma, {
      body: 'Account A admitted send',
      dedupeKey: 'inflight-account-transfer',
      scheduledFor: now,
      title: 'In-flight account transfer',
      userId: accountA.userId,
    })
    let markSendStarted: () => void = () => undefined
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve
    })
    let releaseSend: () => void = () => undefined
    const sendBarrier = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    const worker = processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () => {
            markSendStarted()
            await sendBarrier
            return json({ data: [{ id: 'inflight-account-transfer-ticket', status: 'ok' }] })
          },
        },
      },
      { now, onlyIds: [queued.id] },
    )
    await sendStarted

    let transferSettled = false
    const transfer = Promise.resolve(register(accountB.accessToken, 2)).then((response) => {
      transferSettled = true
      return response
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    const transferSettledBeforeSend = transferSettled
    releaseSend()
    const [metrics, transferResponse] = await Promise.all([worker, transfer])

    expect(transferSettledBeforeSend).toBe(false)
    expect(metrics.sent).toBe(1)
    expect(transferResponse.status).toBe(200)
    expect((await register(accountA.accessToken, 1)).status).toBe(409)
    expect(await prisma.pushToken.findUnique({
      where: { expoPushToken },
      select: { registrationSessionId: true, userId: true },
    })).toEqual({
      registrationSessionId: accountB.sessionId,
      userId: accountB.userId,
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

    await runCronTask(
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

  test('does not claim a stale receipt candidate after another worker schedules backoff', async () => {
    const session = await registerUser('receipt-due-claim@example.com')
    const now = new Date('2026-05-21T12:00:00.000Z')
    const queued = await enqueuePushNotification(prisma, {
      body: 'Receipt due claim body',
      dedupeKey: 'receipt-due-claim-test',
      title: 'Receipt due claim title',
      userId: session.userId,
    })
    const delivery = await prisma.pushDelivery.create({
      data: {
        outboxId: queued.id,
        receiptNextCheckAt: now,
        status: PushDeliveryStatus.sent,
        ticketId: 'ticket-receipt-due-claim',
        userId: session.userId,
      },
    })

    let markStaleCandidateSelected: () => void = () => undefined
    const staleCandidateSelected = new Promise<void>((resolve) => {
      markStaleCandidateSelected = resolve
    })
    let releaseStaleCandidate: () => void = () => undefined
    const staleCandidateBarrier = new Promise<void>((resolve) => {
      releaseStaleCandidate = resolve
    })
    const staleWorkerPrisma = prisma.$extends({
      query: {
        pushDelivery: {
          async findMany({ args, query }) {
            const candidates = await query(args)
            markStaleCandidateSelected()
            await staleCandidateBarrier
            return candidates
          },
        },
      },
    })
    let receiptRequests = 0
    const fetchImpl = async () => {
      receiptRequests += 1
      return json({ data: {} })
    }

    const staleWorker = checkPushReceipts(
      {
        env,
        prisma: staleWorkerPrisma as unknown as DbClient,
        pushClientOptions: { fetchImpl },
      },
      { now },
    )
    await staleCandidateSelected

    const currentWorkerMetrics = await checkPushReceipts(
      { env, prisma, pushClientOptions: { fetchImpl } },
      { now },
    )
    const rescheduled = await prisma.pushDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    })
    releaseStaleCandidate()
    const staleWorkerMetrics = await staleWorker

    expect(currentWorkerMetrics).toEqual({
      checked: 0,
      delivered: 0,
      failed: 0,
      tokensDisabled: 0,
    })
    expect(staleWorkerMetrics).toEqual({
      checked: 0,
      delivered: 0,
      failed: 0,
      tokensDisabled: 0,
    })
    expect(receiptRequests).toBe(1)
    expect(rescheduled.receiptCheckAttempts).toBe(1)
    expect(rescheduled.receiptNextCheckAt?.getTime()).toBeGreaterThan(now.getTime())
    expect(await prisma.pushDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
      .toMatchObject({
        receiptCheckAttempts: 1,
        receiptClaimToken: null,
        receiptClaimedAt: null,
        receiptNextCheckAt: rescheduled.receiptNextCheckAt,
        status: PushDeliveryStatus.sent,
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

  test('a later retryable receipt cannot reset an actively reclaimed outbox', async () => {
    const session = await registerUser('receipt-retry-fencing@example.com')
    const now = new Date('2026-05-21T12:00:00.000Z')
    const queued = await enqueuePushNotification(prisma, {
      body: 'Receipt retry fencing body',
      dedupeKey: 'receipt-retry-fencing-test',
      scheduledFor: now,
      title: 'Receipt retry fencing title',
      userId: session.userId,
    })
    await prisma.pushNotificationOutbox.update({
      where: { id: queued.id },
      data: { attempts: 1, processedAt: now, status: PushNotificationOutboxStatus.sent },
    })
    const firstClaim = randomUUID()
    const secondClaim = randomUUID()
    const [firstDelivery, secondDelivery] = await Promise.all([
      prisma.pushDelivery.create({
        data: {
          outboxId: queued.id,
          receiptClaimToken: firstClaim,
          receiptClaimedAt: now,
          status: PushDeliveryStatus.sent,
          ticketId: 'ticket-retry-fencing-1',
          userId: session.userId,
        },
      }),
      prisma.pushDelivery.create({
        data: {
          outboxId: queued.id,
          receiptClaimToken: secondClaim,
          receiptClaimedAt: now,
          status: PushDeliveryStatus.sent,
          ticketId: 'ticket-retry-fencing-2',
          userId: session.userId,
        },
      }),
    ])

    expect(
      await requeueRetryableReceipt(prisma, {
        deliveryId: firstDelivery.id,
        message: 'retry first delivery',
        now,
        outboxAttempts: 1,
        outboxId: queued.id,
        receiptCheckAttempts: 0,
        receiptClaimToken: firstClaim,
      }),
    ).toBe(true)
    const pending = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: { id: queued.id },
    })
    const processingToken = await claimPushOutboxItemForProcessing(
      prisma,
      queued.id,
      pending.scheduledFor,
    )
    expect(processingToken).toBeString()

    expect(
      await requeueRetryableReceipt(prisma, {
        deliveryId: secondDelivery.id,
        message: 'retry second delivery',
        now,
        outboxAttempts: 1,
        outboxId: queued.id,
        receiptCheckAttempts: 0,
        receiptClaimToken: secondClaim,
      }),
    ).toBe(false)

    expect(await prisma.pushNotificationOutbox.findUniqueOrThrow({ where: { id: queued.id } }))
      .toMatchObject({
        processingToken,
        status: PushNotificationOutboxStatus.processing,
      })
    expect(await prisma.pushDelivery.findUniqueOrThrow({ where: { id: secondDelivery.id } }))
      .toMatchObject({
        receiptClaimToken: null,
        status: PushDeliveryStatus.sent,
      })
  })

  test('missing receipts back off before terminal stale failure', async () => {
    const session = await registerUser('missing-receipt@example.com')
    const sentAt = new Date('2026-05-21T12:00:00.000Z')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[missing-receipt-token]',
        registrationSessionId: session.sessionId,
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

  test('does not persist provider tickets after the outbox processing claim is lost', async () => {
    const session = await registerUser('lost-send-claim@example.com')
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[lost-send-claim]',
        registrationSessionId: session.sessionId,
        userId: session.userId,
      },
    })
    const now = new Date('2026-05-21T12:00:00.000Z')
    const queued = await enqueuePushNotification(prisma, {
      body: 'Lost claim body',
      dedupeKey: 'lost-send-claim-test',
      scheduledFor: now,
      title: 'Lost claim title',
      userId: session.userId,
    })
    const replacementToken = randomUUID()
    let replacementSettled = false
    let replacementClaim: Promise<{ count: number }> | undefined

    const metrics = await processPushOutbox(
      {
        env,
        prisma,
        pushClientOptions: {
          fetchImpl: async () => {
            replacementClaim = prisma.pushNotificationOutbox.updateMany({
              where: {
                id: queued.id,
                status: PushNotificationOutboxStatus.processing,
              },
              data: { processingToken: replacementToken },
            }).then((result) => {
              replacementSettled = true
              return result
            })
            await new Promise<void>((resolve) => setTimeout(resolve, 50))
            expect(replacementSettled).toBe(false)
            return json({ data: [{ id: 'ticket-lost-claim', status: 'ok' }] })
          },
        },
      },
      { now, onlyIds: [queued.id] },
    )
    expect((await replacementClaim)?.count).toBe(1)

    expect(metrics.transientFailed).toBe(1)
    expect(await prisma.pushDelivery.count({ where: { outboxId: queued.id } })).toBe(0)
    const outbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: { id: queued.id },
    })
    expect(outbox.status).toBe(PushNotificationOutboxStatus.processing)
    expect(outbox.processingToken).toBe(replacementToken)
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
    ).resolves.toBeNull()

    let outbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: {
        id: queued.id,
      },
    })
    expect(outbox.status).toBe(PushNotificationOutboxStatus.pending)
    expect(outbox.scheduledFor).toEqual(retryAt)

    const processingToken = await claimPushOutboxItemForProcessing(prisma, queued.id, retryAt)
    expect(processingToken).toMatch(/^[0-9a-f-]{36}$/)

    outbox = await prisma.pushNotificationOutbox.findUniqueOrThrow({
      where: {
        id: queued.id,
      },
    })
    expect(outbox.status).toBe(PushNotificationOutboxStatus.processing)
    expect(outbox.processingToken).toBe(processingToken)

    const replacementToken = '018fd4f2-1f3a-7c88-bc49-555555555555'
    await prisma.pushNotificationOutbox.update({
      where: { id: queued.id },
      data: { processingToken: replacementToken },
    })
    const staleFinalization = await prisma.pushNotificationOutbox.updateMany({
      where: {
        id: queued.id,
        processingToken,
        status: PushNotificationOutboxStatus.processing,
      },
      data: { status: PushNotificationOutboxStatus.sent },
    })
    expect(staleFinalization.count).toBe(0)
  })

  test('partial batch success stores tickets and retries only unsent tokens', async () => {
    const session = await registerUser('partial-batch@example.com')
    for (const index of Array.from({ length: 101 }, (_, value) => value)) {
      await prisma.pushToken.create({
        data: {
          expoPushToken: `ExponentPushToken[partial-${index}]`,
          registrationSessionId: session.sessionId,
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

  test('processPushOutbox refreshes the processing heartbeat before later batches', async () => {
    const session = await registerUser('heartbeat@example.com')
    await prisma.pushToken.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        expoPushToken: `ExponentPushToken[heartbeat-${index}]`,
        registrationSessionId: session.sessionId,
        userId: session.userId,
      })),
    })
    const queued = await enqueuePushNotification(prisma, {
      body: 'Heartbeat body',
      dedupeKey: 'heartbeat-test',
      title: 'Heartbeat title',
      userId: session.userId,
    })
    const staleUpdatedAt = new Date('2026-01-01T00:00:00.000Z')
    await prisma.pushNotificationOutbox.update({
      where: { id: queued.id },
      data: { updatedAt: staleUpdatedAt },
    })
    let sendCallCount = 0
    let secondBatchHeartbeat: unknown = null
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      sendCallCount += 1
      const body = JSON.parse(String(init?.body)) as Array<{ to: string }>

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

  test('a delayed DeviceNotRegistered ticket cannot disable a newer installation generation', async () => {
    const session = await registerUser('late-dead-token-ticket@example.com')
    const expoPushToken = 'ExponentPushToken[late-dead-token-ticket]'
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
      body: 'Generation one ticket',
      dedupeKey: 'late-dead-token-ticket',
      title: 'Generation ticket snapshot',
      userId: session.userId,
    })

    let releaseTicketPersistence: () => void = () => undefined
    let markSendCommitted: () => void = () => undefined
    const ticketPersistenceBarrier = new Promise<void>((resolve) => {
      releaseTicketPersistence = resolve
    })
    const sendCommitted = new Promise<void>((resolve) => {
      markSendCommitted = resolve
    })
    let transactionCalls = 0
    const gatedPrisma = new Proxy(prisma, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (typeof value !== 'function') return value
        const bound = value.bind(target)
        if (property !== '$transaction') return bound

        return new Proxy(bound, {
          async apply(method, thisArg, args) {
            transactionCalls += 1
            const result = await Reflect.apply(method, thisArg, args)
            if (transactionCalls === 2) {
              markSendCommitted()
              await ticketPersistenceBarrier
            }
            return result
          },
        })
      },
    }) as DbClient

    const worker = processPushOutbox(
      {
        env,
        prisma: gatedPrisma,
        pushClientOptions: {
          fetchImpl: async () => json({
            data: [{
              details: { error: 'DeviceNotRegistered' },
              message: 'Generation one is no longer registered',
              status: 'error',
            }],
          }),
        },
      },
      { onlyIds: [queued.id] },
    )
    await sendCommitted

    expect((await register(2)).status).toBe(200)
    releaseTicketPersistence()
    await worker

    expect(await prisma.pushToken.findUniqueOrThrow({
      where: { expoPushToken },
      select: {
        disabledAt: true,
        installation: { select: { generation: true } },
      },
    })).toEqual({
      disabledAt: null,
      installation: { generation: 2 },
    })
    expect(await prisma.pushDelivery.findFirstOrThrow({
      where: { outboxId: queued.id },
      select: { registrationGeneration: true },
    })).toEqual({ registrationGeneration: 1 })
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
