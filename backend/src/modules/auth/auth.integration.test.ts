import { createHash } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { EmailDeliveryError, type EmailDelivery, type EmailMessage } from '../../email'
import { loadEnv } from '../../env'
import { drainTaskOutbox } from '../../outbox'
import type { BackendRuntime } from '../../runtime'
import { createPasswordResetTaskQueue } from './infrastructure/password-reset-task-queue'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; run bun run test:backend:integration')

describe('auth API integration', () => {
  const envInput = {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: 'http://localhost:5173',
    // Short enough that a test can observe an access token expiring.
    ACCESS_TOKEN_TTL_SECONDS: '60',
  }
  const env = loadEnv(envInput)
  const prisma = createPrisma(databaseUrl)
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.taskOutbox.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
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
    expect(registerBody.user.role).toBe('user')
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
    expect(refresh.headers.get('set-cookie')).toBeNull()

    // With the session count below, this proves the rotation kept the one logical session.
    const meWithRefreshedAccessToken = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${refreshBody.accessToken}`,
      },
    })
    expect(meWithRefreshedAccessToken.status).toBe(200)

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

  test('resets a password with a single-use token and revokes existing sessions', async () => {
    const { app: emailApp, drain, messages } = resetMailbox()
    const registered = await registerAccount('reset@example.com')

    const unknownRequest = await requestPasswordReset(emailApp, 'unknown@example.com')
    const [resetRequest, concurrentResetRequest] = await Promise.all([
      requestPasswordReset(emailApp, 'reset@example.com'),
      requestPasswordReset(emailApp, 'reset@example.com'),
    ])

    expect(unknownRequest.status).toBe(202)
    expect(resetRequest.status).toBe(202)
    expect(concurrentResetRequest.status).toBe(202)
    const acceptedBody = await unknownRequest.json()
    expect(await resetRequest.json()).toEqual(acceptedBody)
    expect(await concurrentResetRequest.json()).toEqual(acceptedBody)
    // The accept is a promise the system can keep: the work is committed before the response,
    // and nothing account-dependent has happened yet.
    expect(await prisma.taskOutbox.count({ where: { status: 'pending' } })).toBeGreaterThan(0)
    expect(await prisma.passwordResetToken.count()).toBe(0)

    const drained = await drain()

    // One address exists and one does not: one email, one deliberate skip, no failures.
    expect(drained).toMatchObject({ done: 1, skipped: 1, terminalFailed: 0, transientFailed: 0 })
    expect(messages).toHaveLength(1)

    const token = resetTokenFrom(messages[0]!)
    const storedToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: token },
    })
    expect(storedToken).toBeNull()
    expect(await prisma.passwordResetToken.count()).toBe(1)

    const confirmations = await Promise.all([
      confirmPasswordReset(emailApp, token),
      confirmPasswordReset(emailApp, token),
    ])
    expect(confirmations.map(({ status }) => status).sort()).toEqual([204, 400])
    const successfulConfirm = confirmations.find(({ status }) => status === 204)!
    const rejectedConfirm = confirmations.find(({ status }) => status === 400)!
    // An empty refresh cookie signs this browser out along with every other session.
    expect(successfulConfirm.headers.get('set-cookie')).toStartWith('web_app_demo_refresh=;')
    expect((await rejectedConfirm.json()).error.code).toBe('AUTH_PASSWORD_RESET_INVALID')
    await drain()
    // The reset link and then one password-changed notice, both to the account address.
    expect(messages.map(({ to }) => to)).toEqual(['reset@example.com', 'reset@example.com'])

    // Nothing is left holding the submitted address once the work is finished.
    const finished = await prisma.taskOutbox.findMany({ where: { type: { startsWith: 'auth:' } } })
    expect(finished.every((row) => ['done', 'skipped'].includes(row.status))).toBe(true)
    expect(finished.every((row) => row.redactedAt !== null)).toBe(true)
    expect(finished.map((row) => row.payload)).toEqual(finished.map(() => ({})))
    expect(finished.map((row) => row.dedupeKey).join(' ')).not.toContain('example.com')

    // Draining again must not send a second copy of anything.
    await drain()
    expect(messages).toHaveLength(2)

    const replay = await confirmPasswordReset(emailApp, token)
    expect(replay.status).toBe(400)
    expect((await replay.json()).error.code).toBe('AUTH_PASSWORD_RESET_INVALID')

    const previousAccess = await emailApp.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${registered.accessToken}` },
    })
    const previousRefresh = await emailApp.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: registered.refreshToken }),
    })
    const previousPassword = await emailApp.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset@example.com', password: 'password123' }),
    })
    const newPassword = await emailApp.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset@example.com', password: 'new-password-123' }),
    })

    expect(previousAccess.status).toBe(401)
    expect(previousRefresh.status).toBe(401)
    expect(previousPassword.status).toBe(401)
    expect(newPassword.status).toBe(200)
  })

  test('only reset rows the next drain pass can claim count against the ceiling', async () => {
    // A failed delivery parks its row as pending with a due time minutes ahead. Counting those
    // would let a provider outage fill the ceiling with real resets in backoff and then drop
    // every new request for as long as the outage lasts. Other task types share the table and
    // the status, and have their own budget.
    const queue = createPasswordResetTaskQueue(prisma, { pendingLimit: 2 })
    const now = new Date('2026-08-09T12:00:00.000Z')
    const retryAt = new Date(now.getTime() + 120_000)
    // Enough of each kind to fill the ceiling on its own, so counting either would refuse.
    await prisma.taskOutbox.createMany({
      data: [
        { type: 'auth:password-reset', dedupeKey: 'parked-1', payload: {}, scheduledFor: retryAt },
        { type: 'auth:password-reset', dedupeKey: 'parked-2', payload: {}, scheduledFor: retryAt },
        { type: 'auth:password-changed', dedupeKey: 'other-1', payload: {}, scheduledFor: now },
        { type: 'auth:password-changed', dedupeKey: 'other-2', payload: {}, scheduledFor: now },
      ],
    })
    const resetRows = () => prisma.taskOutbox.count({ where: { type: 'auth:password-reset' } })

    await queue.enqueuePasswordReset({ email: 'user@example.com', now })
    expect(await resetRows()).toBe(3)

    // Once the retries are due they are claimable, so they fill the batch like any other row.
    await queue.enqueuePasswordReset({
      email: 'other@example.com',
      now: new Date(retryAt.getTime() + 60_000),
    })
    expect(await resetRows()).toBe(3)
  })

  test('a later reset request for the same address queues new work', async () => {
    // A key made of the address alone would match the first finished task forever, and the
    // owner of that address could never reset a password again.
    const queue = createPasswordResetTaskQueue(prisma, { pendingLimit: 10 })

    await queue.enqueuePasswordReset({ email: 'user@example.com', now: new Date('2026-08-09T12:00:00.000Z') })
    await queue.enqueuePasswordReset({ email: 'user@example.com', now: new Date('2026-08-09T12:05:00.000Z') })

    expect(await prisma.taskOutbox.count({ where: { type: 'auth:password-reset' } })).toBe(2)
  })

  test('a reset inside the cooldown sends nothing and keeps the outstanding link', async () => {
    const mailbox = resetMailbox()
    const { userId } = await registerAccount('cooldown@example.com')
    const outstandingToken = 'o'.repeat(43)
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: createHash('sha256').update(outstandingToken).digest('hex'),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })

    await requestPasswordReset(mailbox.app, 'cooldown@example.com')

    expect(await mailbox.drain()).toMatchObject({ done: 0, skipped: 1 })
    expect(mailbox.messages).toEqual([])
    expect((await confirmPasswordReset(mailbox.app, outstandingToken)).status).toBe(204)
  })

  test('a transient delivery failure keeps the reset link for the next attempt', async () => {
    const mailbox = resetMailbox(new EmailDeliveryError('transient', 'Provider unavailable'))
    await registerAccount('transient@example.com')
    await requestPasswordReset(mailbox.app, 'transient@example.com')

    expect(await mailbox.drain()).toMatchObject({ transientFailed: 1 })
    expect((await confirmPasswordReset(mailbox.app, resetTokenFrom(mailbox.messages[0]!))).status).toBe(204)
  })

  test('a permanent delivery failure invalidates the reset link at once', async () => {
    const mailbox = resetMailbox(new EmailDeliveryError('permanent', 'Provider rejected the recipient'))
    await registerAccount('permanent@example.com')
    await requestPasswordReset(mailbox.app, 'permanent@example.com')

    expect(await mailbox.drain()).toMatchObject({ terminalFailed: 1 })
    const confirm = await confirmPasswordReset(mailbox.app, resetTokenFrom(mailbox.messages[0]!))
    expect(confirm.status).toBe(400)
    expect((await confirm.json()).error.code).toBe('AUTH_PASSWORD_RESET_INVALID')
  })

  test('the last failed delivery attempt invalidates the reset link', async () => {
    const mailbox = resetMailbox(new EmailDeliveryError('transient', 'Provider unavailable'))
    await registerAccount('last-attempt@example.com')
    await requestPasswordReset(mailbox.app, 'last-attempt@example.com')
    // Four attempts have already failed, so this drain makes the fifth and last one.
    await prisma.taskOutbox.updateMany({ where: { type: 'auth:password-reset' }, data: { attempts: 4 } })

    expect(await mailbox.drain()).toMatchObject({ terminalFailed: 1 })
    const confirm = await confirmPasswordReset(mailbox.app, resetTokenFrom(mailbox.messages[0]!))
    expect(confirm.status).toBe(400)
    expect((await confirm.json()).error.code).toBe('AUTH_PASSWORD_RESET_INVALID')
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

    const attackerCredential = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshedAgain.refreshToken }),
    })
    expect(attackerCredential.status).toBe(401)
  })

  test('a token forged around a leaked family locator cannot revoke the session', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'forged-family@example.com', password: 'password123' }),
    })
    const registered = await register.json()
    const [familyId] = registered.refreshToken.split('.')

    // The family locator travels in the clear inside the token, so a partial leak hands an
    // attacker exactly this much. It must not be enough to make the reuse check fire.
    const forged = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: `${familyId}.${'f'.repeat(43)}.${'g'.repeat(43)}` }),
    })
    expect(forged.status).toBe(401)

    const owner = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: registered.refreshToken }),
    })
    expect(owner.status).toBe(200)

    const session = await prisma.authSession.findFirst({
      where: { user: { email: 'forged-family@example.com' } },
    })
    expect(session?.revokedAt).toBeNull()
  })

  test('cookie auth keeps the refresh token in an HttpOnly cookie and out of the body', async () => {
    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
      },
      body: JSON.stringify({}),
    })
    const refreshBody = await refresh.json()

    expect(refresh.status).toBe(200)
    expect(refreshBody.accessToken).toBeString()
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
    expect(Array.isArray(body.error.details)).toBe(true)
  })

  test('me rejects revoked, expired, and missing sessions', async () => {
    const revoked = await registerAccount('me-revoked@example.com')
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

    const expired = await registerAccount('me-expired@example.com')
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

    const missing = await registerAccount('me-missing@example.com')
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
    const absoluteExpired = await registerAccount('absolute-expired@example.com')
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

    const nearCutoff = await registerAccount('absolute-near-cutoff@example.com')
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

  async function registerAccount(email: string) {
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

  /** An email provider that records every message, and then fails with `failure` if one is given. */
  function resetMailbox(failure?: EmailDeliveryError) {
    const messages: EmailMessage[] = []
    const emailDelivery: EmailDelivery = {
      driver: 'console',
      configured: true,
      send: async (message) => {
        messages.push(message)
        if (failure) throw failure
      },
    }
    // The drain runs outside any request, so it builds its own auth service from the runtime.
    const drainRuntime = { emailDelivery, env, prisma } as unknown as BackendRuntime

    return {
      app: createApp({ emailDelivery, env, prisma }),
      messages,
      async drain() {
        // The drain logs each task it gives up on. These tests read its metrics instead.
        const error = spyOn(console, 'error').mockImplementation(() => {})
        try {
          return await drainTaskOutbox(drainRuntime, { now: new Date() })
        } finally {
          error.mockRestore()
        }
      },
    }
  }

  function requestPasswordReset(emailApp: ReturnType<typeof createApp>, email: string) {
    return emailApp.request('/api/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  }

  function confirmPasswordReset(emailApp: ReturnType<typeof createApp>, token: string) {
    return emailApp.request('/api/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'new-password-123' }),
    })
  }
})

/** The token travels in the URL fragment, which a browser never sends to a server. */
function resetTokenFrom(message: EmailMessage) {
  const link = new URL(message.text.match(/https?:\/\/\S+/)![0])
  const token = new URLSearchParams(link.hash.slice(1)).get('token')
  expect(token).toBeString()
  return token!
}
