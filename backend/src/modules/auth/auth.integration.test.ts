import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'
import { socialAuthProviderDeps } from './infrastructure/social-providers'

const databaseUrl = process.env.TEST_DATABASE_URL

const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('auth API integration', () => {
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
  const originalVerifyGoogleIdToken = socialAuthProviderDeps.verifyGoogleIdToken
  const originalVerifyAppleIdToken = socialAuthProviderDeps.verifyAppleIdToken

  beforeEach(async () => {
    socialAuthProviderDeps.verifyGoogleIdToken = originalVerifyGoogleIdToken
    socialAuthProviderDeps.verifyAppleIdToken = originalVerifyAppleIdToken
    await prisma.pushToken.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterEach(() => {
    socialAuthProviderDeps.verifyGoogleIdToken = originalVerifyGoogleIdToken
    socialAuthProviderDeps.verifyAppleIdToken = originalVerifyAppleIdToken
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('registers, reads me, refreshes, and logs out', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'password123',
        displayName: 'User',
      }),
    })
    const registerBody = await register.json()

    expect(register.status).toBe(201)
    expect(registerBody.user.email).toBe('user@example.com')
    expect(registerBody.accessToken).toBeString()
    expect(registerBody.refreshToken).toBeString()
    expect(register.headers.get('set-cookie')).toBeNull()

    const me = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${registerBody.accessToken}`,
      },
    })
    expect(me.status).toBe(200)
    const meBody = await me.json()
    expect(meBody).toEqual({ user: registerBody.user })
    expect('sessionId' in meBody.user).toBe(false)

    const refresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
    })
    const refreshBody = await refresh.json()
    expect(refresh.status).toBe(200)
    expect(refreshBody.accessToken).toBeString()
    expect(refreshBody.refreshToken).toBeString()
    expect(refreshBody.refreshToken).not.toBe(registerBody.refreshToken)
    expect(refreshBody.session).toBeUndefined()
    expect(refresh.headers.get('set-cookie')).toBeNull()

    const meWithPreRefreshAccessToken = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${registerBody.accessToken}`,
      },
    })
    expect(meWithPreRefreshAccessToken.status).toBe(200)

    const sessionsAfterRefresh = await prisma.authSession.count({
      where: {
        user: {
          email: 'user@example.com',
        },
      },
    })
    expect(sessionsAfterRefresh).toBe(1)

    const staleRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
    })
    const staleRefreshBody = await staleRefresh.json()
    expect(staleRefresh.status).toBe(200)
    expect(staleRefreshBody.refreshToken).toBeString()

    const logout = await app.request('/api/auth/token/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: staleRefreshBody.refreshToken }),
    })
    expect(logout.status).toBe(204)

    const revokedRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: staleRefreshBody.refreshToken }),
    })
    expect(revokedRefresh.status).toBe(401)
  })

  test('logout removes submitted Expo push tokens under refresh-token authority', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'logout-push@example.com',
        password: 'password123',
      }),
    })
    const registerBody = await register.json()
    await prisma.pushToken.createMany({
      data: [
        {
          expoPushToken: 'ExponentPushToken[logout-token]',
          userId: registerBody.user.id,
        },
        {
          expoPushToken: 'ExponentPushToken[logout-old-token]',
          userId: registerBody.user.id,
        },
      ],
    })

    const logout = await app.request('/api/auth/token/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expoPushToken: 'ExponentPushToken[logout-token]',
        expoPushTokens: ['ExponentPushToken[logout-old-token]'],
        refreshToken: registerBody.refreshToken,
      }),
    })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('X-Auth-Session-Revoked')).toBe('true')
    expect(
      await prisma.pushToken.count({
        where: {
          expoPushToken: 'ExponentPushToken[logout-token]',
        },
      }),
    ).toBe(0)
    expect(
      await prisma.pushToken.count({
        where: {
          expoPushToken: 'ExponentPushToken[logout-old-token]',
        },
      }),
    ).toBe(0)
  })

  test('logout does not remove push tokens when refresh authority is stale', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'stale-logout-push@example.com',
        password: 'password123',
      }),
    })
    const registerBody = await register.json()
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[stale-logout-token]',
        userId: registerBody.user.id,
      },
    })

    const firstLogout = await app.request('/api/auth/token/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: registerBody.refreshToken,
      }),
    })
    expect(firstLogout.status).toBe(204)

    const staleAuthorityLogout = await app.request('/api/auth/token/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expoPushToken: 'ExponentPushToken[stale-logout-token]',
        refreshToken: registerBody.refreshToken,
      }),
    })
    expect(staleAuthorityLogout.status).toBe(204)
    expect(staleAuthorityLogout.headers.get('X-Auth-Session-Revoked')).toBe('false')
    expect(
      await prisma.pushToken.count({
        where: {
          expoPushToken: 'ExponentPushToken[stale-logout-token]',
        },
      }),
    ).toBe(1)
  })

  test('returns one durable successor across three concurrent refresh requests', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'race@example.com',
        password: 'password123',
      }),
    })
    const registerBody = await register.json()

    const refreshRequests = await Promise.all([
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
    ])

    const statuses = refreshRequests.map((response) => response.status)
    expect(statuses).toEqual([200, 200, 200])
    const refreshBodies = await Promise.all(refreshRequests.map((response) => response.json()))
    const returnedRefreshTokens = refreshBodies.map((body) => body.refreshToken)
    expect(new Set(returnedRefreshTokens).size).toBe(1)

    const activeSessions = await prisma.authSession.count({
      where: {
        user: {
          email: 'race@example.com',
        },
        revokedAt: null,
      },
    })
    expect(activeSessions).toBe(1)

    const totalSessions = await prisma.authSession.count({
      where: {
        user: {
          email: 'race@example.com',
        },
      },
    })
    expect(totalSessions).toBe(1)

    await prisma.authSession.updateMany({
      where: { user: { email: 'race@example.com' } },
      data: { refreshRotatedAt: new Date(Date.now() - 60_000) },
    })

    const delayedWinner = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: returnedRefreshTokens.at(-1) }),
    })
    expect(delayedWinner.status).toBe(200)
  })

  test('revokes a session when any older refresh credential is reused after grace', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reuse@example.com', password: 'password123' }),
    })
    const registered = await register.json()
    const refresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: registered.refreshToken }),
    })
    const refreshed = await refresh.json()

    const refreshAgain = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshed.refreshToken }),
    })
    const refreshedAgain = await refreshAgain.json()
    expect(refreshAgain.status).toBe(200)

    const pushToken = 'ExponentPushToken[reused-session-token]'
    const pushRegistration = await app.request('/api/notifications/push-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${registered.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expoPushToken: pushToken,
        generation: 1,
        installationId: randomUUID(),
        installationSecret: randomUUID(),
      }),
    })
    expect(pushRegistration.status).toBe(200)
    expect(await prisma.pushToken.findUnique({ where: { expoPushToken: pushToken } }))
      .not.toBeNull()

    await prisma.authSession.updateMany({
      where: { user: { email: 'reuse@example.com' } },
      data: { refreshRotatedAt: new Date(Date.now() - 60_000) },
    })

    const replay = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: registered.refreshToken }),
    })
    expect(replay.status).toBe(401)
    expect(await prisma.pushToken.findUnique({ where: { expoPushToken: pushToken } }))
      .toBeNull()

    const attackerCredential = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshedAgain.refreshToken }),
    })
    expect(attackerCredential.status).toBe(401)
  })

  test('web auth never exposes its HttpOnly refresh token when the client platform header is spoofed', async () => {
    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({
        email: 'web-cookie@example.com',
        password: 'password123',
      }),
    })
    const registerBody = await register.json()
    const setCookie = register.headers.get('set-cookie')

    expect(register.status).toBe(201)
    expect(registerBody.refreshToken).toBeUndefined()
    expect(setCookie).toContain('web_app_demo_refresh=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')

    const refresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setCookie!.split(';')[0],
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({}),
    })
    const refreshBody = await refresh.json()

    expect(refresh.status).toBe(200)
    expect(refreshBody.accessToken).toBeString()
    expect(refreshBody.session).toBeUndefined()
    expect(refreshBody.refreshToken).toBeUndefined()
  })

  test('does not let cookie and explicit token transports borrow each other credentials', async () => {
    const refreshToken = 'r'.repeat(32)
    const cookieWithBodyToken = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    expect(cookieWithBodyToken.status).toBe(400)

    const tokenWithCookieOnly = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `web_app_demo_refresh=${refreshToken}`,
      },
      body: JSON.stringify({}),
    })
    expect(tokenWithCookieOnly.status).toBe(400)
  })

  test('production web auth allows an exact same-site custom-domain origin', async () => {
    const productionApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://web.example.com'],
        COOKIE_SECURE: true,
      },
      prisma,
    })
    const register = await productionApp.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({
        email: 'production-cookie@example.com',
        password: 'password123',
      }),
    })
    const registerBody = await register.json()
    const setCookie = register.headers.get('set-cookie')

    expect(register.status).toBe(201)
    expect(register.headers.get('access-control-allow-origin')).toBe('https://web.example.com')
    expect(register.headers.get('access-control-allow-credentials')).toBe('true')
    expect(registerBody.refreshToken).toBeUndefined()
    expect(setCookie).toContain('web_app_demo_refresh=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=None')
  })

  test('production cookie auth rejects untrusted refresh and logout origins', async () => {
    const productionApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://web.example.com'],
        COOKIE_SECURE: true,
      },
      prisma,
    })
    const register = await productionApp.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({
        email: 'csrf-cookie@example.com',
        password: 'password123',
      }),
    })
    const cookie = register.headers.get('set-cookie')!.split(';')[0]

    const noOriginRefresh = await productionApp.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({}),
    })
    const noOriginBody = await noOriginRefresh.json()
    expect(noOriginRefresh.status).toBe(403)
    expect(noOriginBody.error.code).toBe('FORBIDDEN')

    const untrustedLogout = await productionApp.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({}),
    })
    const untrustedLogoutBody = await untrustedLogout.json()
    expect(untrustedLogout.status).toBe(403)
    expect(untrustedLogoutBody.error.code).toBe('FORBIDDEN')

    const allowedRefresh = await productionApp.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({}),
    })
    expect(allowedRefresh.status).toBe(200)
  })

  test('guards me and returns stable validation errors', async () => {
    const unauthorizedMe = await app.request('/api/auth/me')
    expect(unauthorizedMe.status).toBe(401)

    const invalidRegister = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        password: 'short',
      }),
    })
    const body = await invalidRegister.json()

    expect(invalidRegister.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toBe('Invalid request payload')
    expect(Array.isArray(body.error.details)).toBe(true)
  })

  test('me rejects revoked, expired, and missing sessions', async () => {
    const revoked = await registerForMeGuard('me-revoked@example.com')
    await prisma.authSession.updateMany({
      where: {
        userId: revoked.userId,
      },
      data: {
        revokedAt: new Date(),
      },
    })
    const revokedMe = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${revoked.accessToken}`,
      },
    })
    expect(revokedMe.status).toBe(401)

    const expired = await registerForMeGuard('me-expired@example.com')
    await prisma.authSession.updateMany({
      where: {
        userId: expired.userId,
      },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    })
    const expiredMe = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${expired.accessToken}`,
      },
    })
    expect(expiredMe.status).toBe(401)

    const missing = await registerForMeGuard('me-missing@example.com')
    await prisma.authSession.deleteMany({
      where: {
        userId: missing.userId,
      },
    })
    const missingMe = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${missing.accessToken}`,
      },
    })
    expect(missingMe.status).toBe(401)
  })

  test('enforces absolute session lifetime in PostgreSQL for access and refresh credentials', async () => {
    const absoluteExpired = await registerForMeGuard('absolute-expired@example.com')
    await prisma.authSession.updateMany({
      where: { userId: absoluteExpired.userId },
      data: {
        createdAt: new Date(
          Date.now() - (env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 + 60) * 1000,
        ),
      },
    })

    const expiredMe = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${absoluteExpired.accessToken}` },
    })
    const expiredRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: absoluteExpired.refreshToken }),
    })

    expect(expiredMe.status).toBe(401)
    expect(expiredRefresh.status).toBe(401)

    const nearCutoff = await registerForMeGuard('absolute-near-cutoff@example.com')
    await prisma.authSession.updateMany({
      where: { userId: nearCutoff.userId },
      data: {
        createdAt: new Date(
          Date.now() - (env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 - 60) * 1000,
        ),
      },
    })

    const activeMe = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${nearCutoff.accessToken}` },
    })
    const activeRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: nearCutoff.refreshToken }),
    })

    expect(activeMe.status).toBe(200)
    expect(activeRefresh.status).toBe(200)
  })

  test('rejects duplicate email and invalid login', async () => {
    const payload = {
      email: 'dupe@example.com',
      password: 'password123',
    }

    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const duplicate = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(duplicate.status).toBe(409)

    const invalidLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: payload.email,
        password: 'wrong-password',
      }),
    })
    expect(invalidLogin.status).toBe(401)
  })

  test('social Google auth creates a social-only user and mobile session', async () => {
    const socialApp = createApp({
      env: {
        ...env,
        GOOGLE_AUTH_CLIENT_IDS: ['google-ios-client-id', 'google-web-client-id'],
      },
      prisma,
    })
    socialAuthProviderDeps.verifyGoogleIdToken = async () => ({
      provider: 'google',
      subject: 'google-subject-1',
      email: 'Social@Example.com',
      displayName: 'Social User',
    })

    const response = await socialApp.request('/api/auth/token/social/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: 'google-id-token',
      }),
    })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.user.email).toBe('social@example.com')
    expect(body.user.displayName).toBe('Social User')
    expect(body.accessToken).toBeString()
    expect(body.refreshToken).toBeString()

    const user = await prisma.user.findUnique({
      where: { email: 'social@example.com' },
      select: {
        googleSubject: true,
        passwordHash: true,
      },
    })
    expect(user).toEqual({
      googleSubject: 'google-subject-1',
      passwordHash: null,
    })
  })

  test('social Google auth returns an existing user by provider subject', async () => {
    const socialApp = createApp({
      env: {
        ...env,
        GOOGLE_AUTH_CLIENT_IDS: ['google-ios-client-id'],
      },
      prisma,
    })
    const user = await prisma.user.create({
      data: {
        email: 'returning-google@example.com',
        passwordHash: null,
        googleSubject: 'google-returning-subject',
      },
      select: { id: true },
    })
    socialAuthProviderDeps.verifyGoogleIdToken = async () => ({
      provider: 'google',
      subject: 'google-returning-subject',
    })

    const response = await socialApp.request('/api/auth/token/social/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: 'google-id-token',
      }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.user.id).toBe(user.id)
    expect(body.user.email).toBe('returning-google@example.com')
    expect(body.refreshToken).toBeString()
  })

  test('concurrent first-time social auth requests sign into the same provider user', async () => {
    const socialApp = createApp({
      env: {
        ...env,
        GOOGLE_AUTH_CLIENT_IDS: ['google-ios-client-id'],
      },
      prisma,
    })
    let verificationCalls = 0
    let releaseVerificationBarrier: () => void = () => undefined
    const verificationBarrier = new Promise<void>((resolve) => {
      releaseVerificationBarrier = resolve
    })
    socialAuthProviderDeps.verifyGoogleIdToken = async () => {
      verificationCalls += 1
      if (verificationCalls === 2) releaseVerificationBarrier()
      await verificationBarrier

      return {
        provider: 'google',
        subject: 'google-concurrent-subject',
        email: 'google-concurrent@example.com',
      }
    }
    const request = () =>
      socialApp.request('/api/auth/token/social/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idToken: 'google-id-token',
        }),
      })

    const [first, second] = await Promise.all([request(), request()])
    const firstBody = await first.json()
    const secondBody = await second.json()

    expect([first.status, second.status].sort((left, right) => left - right)).toEqual([200, 201])
    expect(firstBody.user.id).toBe(secondBody.user.id)
    expect(firstBody.refreshToken).toBeString()
    expect(secondBody.refreshToken).toBeString()
    expect(
      await prisma.user.count({
        where: {
          googleSubject: 'google-concurrent-subject',
        },
      }),
    ).toBe(1)
  })

  test('social Apple auth creates a user and later works when Apple omits email', async () => {
    const socialApp = createApp({
      env: {
        ...env,
        APPLE_AUTH_BUNDLE_ID: 'com.webappdemo.mobile',
      },
      prisma,
    })
    socialAuthProviderDeps.verifyAppleIdToken = async () => ({
      provider: 'apple',
      subject: 'apple-stable-subject',
      email: 'apple-user@example.com',
    })

    const initial = await socialApp.request('/api/auth/token/social/apple', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: 'apple-first-token',
      }),
    })
    const initialBody = await initial.json()

    expect(initial.status).toBe(201)
    expect(initialBody.user.email).toBe('apple-user@example.com')

    socialAuthProviderDeps.verifyAppleIdToken = async () => ({
      provider: 'apple',
      subject: 'apple-stable-subject',
    })

    const returning = await socialApp.request('/api/auth/token/social/apple', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: 'apple-returning-token',
      }),
    })
    const returningBody = await returning.json()

    expect(returning.status).toBe(200)
    expect(returningBody.user.id).toBe(initialBody.user.id)
    expect(returningBody.refreshToken).toBeString()
  })

  test('social Apple auth rejects new users when Apple does not provide email', async () => {
    const socialApp = createApp({
      env: {
        ...env,
        APPLE_AUTH_BUNDLE_ID: 'com.webappdemo.mobile',
      },
      prisma,
    })
    socialAuthProviderDeps.verifyAppleIdToken = async () => ({
      provider: 'apple',
      subject: 'apple-no-email-subject',
    })

    const response = await socialApp.request('/api/auth/token/social/apple', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: 'apple-token',
      }),
    })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe('AUTH_PROVIDER_EMAIL_REQUIRED')
  })

  test('social auth does not auto-link to an existing password account by email', async () => {
    const socialApp = createApp({
      env: {
        ...env,
        GOOGLE_AUTH_CLIENT_IDS: ['google-ios-client-id'],
      },
      prisma,
    })
    await prisma.user.create({
      data: {
        email: 'existing-password@example.com',
        passwordHash: 'hashed-password',
      },
    })
    socialAuthProviderDeps.verifyGoogleIdToken = async () => ({
      provider: 'google',
      subject: 'google-new-subject',
      email: 'existing-password@example.com',
    })

    const response = await socialApp.request('/api/auth/token/social/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: 'google-id-token',
      }),
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('AUTH_EMAIL_ALREADY_EXISTS')
  })

  test('social auth returns configuration and token verification errors', async () => {
    const missingGoogleConfig = await app.request('/api/auth/token/social/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: 'google-id-token',
      }),
    })
    const missingGoogleConfigBody = await missingGoogleConfig.json()

    expect(missingGoogleConfig.status).toBe(503)
    expect(missingGoogleConfigBody.error.code).toBe('AUTH_PROVIDER_NOT_CONFIGURED')

    const socialApp = createApp({
      env: {
        ...env,
        GOOGLE_AUTH_CLIENT_IDS: ['google-ios-client-id'],
      },
      prisma,
    })
    socialAuthProviderDeps.verifyGoogleIdToken = async () => {
      throw new Error('invalid token')
    }

    const invalidGoogleToken = await socialApp.request('/api/auth/token/social/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: 'google-id-token',
      }),
    })
    const invalidGoogleTokenBody = await invalidGoogleToken.json()

    expect(invalidGoogleToken.status).toBe(401)
    expect(invalidGoogleTokenBody.error.code).toBe('AUTH_INVALID_PROVIDER_TOKEN')
  })

  test('returns one created user and one conflict for concurrent duplicate registration', async () => {
    const payload = {
      email: 'register-race@example.com',
      password: 'password123',
    }

    const [first, second] = await Promise.all([
      app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ])

    const statuses = [first.status, second.status].sort((left, right) => left - right)
    expect(statuses).toEqual([201, 409])

    const users = await prisma.user.count({
      where: {
        email: payload.email,
      },
    })
    expect(users).toBe(1)
  })

  async function registerForMeGuard(email: string) {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: 'password123',
      }),
    })
    const registerBody = await register.json()
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        email,
      },
      select: {
        id: true,
      },
    })

    expect(register.status).toBe(201)
    expect(registerBody.accessToken).toBeString()

    return {
      accessToken: registerBody.accessToken as string,
      refreshToken: registerBody.refreshToken as string,
      userId: user.id,
    }
  }
})
