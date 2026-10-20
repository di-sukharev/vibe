import { createHash } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { cleanupAuthState } from '../auth'
import {
  assertLoginCapableAdmin,
  bootstrapAdmin,
  parseAdminSeedConfig,
} from './infrastructure/admin-bootstrap'
import { bootstrapDevelopmentData } from '../../../scripts/development-seed'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; run bun run test:backend:integration')

describe('users and admin API integration', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: 'http://localhost:5173',
    // Short enough that a test can observe an access token expiring.
    ACCESS_TOKEN_TTL_SECONDS: '60',
  })
  const prisma = createPrisma(databaseUrl)
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.pushToken.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('auth maintenance preserves retention boundaries and removes expired reset tokens', async () => {
    const session = await register('retention@example.com')
    const now = new Date()
    const retentionMs = env.SESSION_RETENTION_DAYS * 86_400_000
    const expiresAt = new Date(now.getTime() - retentionMs)
    await prisma.authSession.updateMany({ where: { userId: session.user.id }, data: { expiresAt } })
    await prisma.passwordResetToken.create({ data: {
      userId: session.user.id, tokenHash: 'retention-test', expiresAt: now,
    } })
    expect(await cleanupAuthState({ prisma, env }, now)).toEqual({
      sessionsDeleted: 0, passwordResetTokensDeleted: 0,
    })
    expect(await cleanupAuthState({ prisma, env }, new Date(now.getTime() + 1))).toEqual({
      sessionsDeleted: 1, passwordResetTokensDeleted: 1,
    })
  })

  test('registers users with the user role and persists profile updates', async () => {
    const session = await register('profile@example.com', 'Initial Name')

    expect(session.user.role).toBe('user')

    const update = await app.request('/api/users/me', {
      method: 'PATCH',
      headers: authenticatedJsonHeaders(session.accessToken),
      body: JSON.stringify({ displayName: '  Updated Name  ' }),
    })
    const updateBody = await update.json()

    expect(update.status).toBe(200)
    expect(updateBody.user).toMatchObject({
      displayName: 'Updated Name',
      email: 'profile@example.com',
      role: 'user',
    })

    const me = await app.request('/api/auth/me', {
      headers: authenticatedHeaders(session.accessToken),
    })
    expect((await me.json()).user.displayName).toBe('Updated Name')

    const clear = await app.request('/api/users/me', {
      method: 'PATCH',
      headers: authenticatedJsonHeaders(session.accessToken),
      body: JSON.stringify({ displayName: null }),
    })
    expect((await clear.json()).user.displayName).toBeNull()

    for (const displayName of ['x', 'x'.repeat(81)]) {
      const invalid = await app.request('/api/users/me', {
        method: 'PATCH',
        headers: authenticatedJsonHeaders(session.accessToken),
        body: JSON.stringify({ displayName }),
      })
      expect(invalid.status).toBe(400)
      expect((await invalid.json()).error.code).toBe('VALIDATION_ERROR')
    }
  })

  test('rejects regular users from every admin endpoint', async () => {
    const session = await register('regular@example.com')

    const dashboard = await app.request('/api/admin/dashboard', {
      headers: authenticatedHeaders(session.accessToken),
    })
    const users = await app.request('/api/admin/users', {
      headers: authenticatedHeaders(session.accessToken),
    })
    const roleChange = await app.request(`/api/admin/users/${session.user.id}/role`, {
      method: 'PATCH',
      headers: authenticatedJsonHeaders(session.accessToken),
      body: JSON.stringify({ role: 'admin' }),
    })

    for (const response of [dashboard, users, roleChange]) {
      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe('FORBIDDEN')
    }
  })

  test('lets admins inspect users and promote an account while revoking its sessions', async () => {
    const admin = await register('admin@example.com', 'Admin')
    await prisma.user.update({
      where: { id: admin.user.id },
      data: { role: 'admin' },
    })
    const target = await register('target@example.com', 'Target')
    const resetTokenBeforePromotion = 'p'.repeat(43)
    await createOutstandingPasswordResetToken(target.user.id, resetTokenBeforePromotion)

    const dashboard = await app.request('/api/admin/dashboard', {
      headers: authenticatedHeaders(admin.accessToken),
    })
    expect(dashboard.status).toBe(200)
    expect(await dashboard.json()).toEqual({
      totalUsers: 2,
      totalAdmins: 1,
      newUsersLast7Days: 2,
    })

    const list = await app.request('/api/admin/users?q=target&page=1&pageSize=20', {
      headers: authenticatedHeaders(admin.accessToken),
    })
    const listBody = await list.json()
    expect(list.status).toBe(200)
    expect(listBody).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      hasNext: false,
    })
    expect(listBody.items).toEqual([
      {
        id: target.user.id,
        email: 'target@example.com',
        displayName: 'Target',
        role: 'user',
        createdAt: target.user.createdAt,
      },
    ])

    const maximumPage = await app.request('/api/admin/users?page=100&pageSize=1', {
      headers: authenticatedHeaders(admin.accessToken),
    })
    expect(maximumPage.status).toBe(200)
    expect(await maximumPage.json()).toMatchObject({
      items: [],
      page: 100,
      pageSize: 1,
      hasNext: false,
    })

    const excessivePage = await app.request('/api/admin/users?page=101', {
      headers: authenticatedHeaders(admin.accessToken),
    })
    expect(excessivePage.status).toBe(400)
    expect((await excessivePage.json()).error.code).toBe('VALIDATION_ERROR')

    const malformedUserId = await app.request('/api/admin/users/not-a-uuid/role', {
      method: 'PATCH',
      headers: authenticatedJsonHeaders(admin.accessToken),
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(malformedUserId.status).toBe(400)
    expect((await malformedUserId.json()).error.code).toBe('VALIDATION_ERROR')

    const promote = await app.request(`/api/admin/users/${target.user.id}/role`, {
      method: 'PATCH',
      headers: authenticatedJsonHeaders(admin.accessToken),
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(promote.status).toBe(200)
    expect((await promote.json()).user.role).toBe('admin')

    const revokedMe = await app.request('/api/auth/me', {
      headers: authenticatedHeaders(target.accessToken),
    })
    expect(revokedMe.status).toBe(401)
    await expectPasswordResetRejected(resetTokenBeforePromotion)

    const promotedLogin = await login('target@example.com')
    const promotedDashboard = await app.request('/api/admin/dashboard', {
      headers: authenticatedHeaders(promotedLogin.accessToken),
    })
    expect(promotedDashboard.status).toBe(200)

    const idempotentPromotion = await app.request(
      `/api/admin/users/${target.user.id}/role`,
      {
        method: 'PATCH',
        headers: authenticatedJsonHeaders(admin.accessToken),
        body: JSON.stringify({ role: 'admin' }),
      },
    )
    expect(idempotentPromotion.status).toBe(200)
    const stillAuthenticated = await app.request('/api/auth/me', {
      headers: authenticatedHeaders(promotedLogin.accessToken),
    })
    expect(stillAuthenticated.status).toBe(200)
  })

  test('gives each admin one directory read budget, separate from account writes', async () => {
    // Keyed by administrator: a new filter, session, or client address must not buy more reads,
    // or rotating any of them walks past the limit. Account writes spend a budget of their own.
    const admin = await register('budget-admin@example.com')
    const otherAdmin = await register('budget-other-admin@example.com')
    await prisma.user.updateMany({
      where: { id: { in: [admin.user.id, otherAdmin.user.id] } },
      data: { role: 'admin' },
    })
    const secondSession = await login(admin.user.email)
    const budgetApp = createApp({
      env: {
        ...env,
        ADMIN_USERS_READ_RATE_LIMIT_MAX: 2,
        AUTH_RATE_LIMIT_MAX: 1,
        TRUST_PROXY: true,
        TRUSTED_PROXY_CLIENT_IP_HEADER: 'do-connecting-ip',
      },
      prisma,
    })
    const read = (accessToken: string, query: string, clientIp: string) =>
      budgetApp.request(`/api/admin/users?q=${query}`, {
        headers: { ...authenticatedHeaders(accessToken), 'Do-Connecting-Ip': clientIp },
      })
    const rename = (accessToken: string) =>
      budgetApp.request('/api/users/me', {
        method: 'PATCH',
        headers: { ...authenticatedJsonHeaders(accessToken), 'Do-Connecting-Ip': '203.0.113.10' },
        body: JSON.stringify({ displayName: 'Budget Admin' }),
      })

    expect((await read(admin.accessToken, 'first', '203.0.113.1')).status).toBe(200)
    expect((await read(secondSession.accessToken, 'second', '203.0.113.2')).status).toBe(200)
    const limited = await read(admin.accessToken, 'third', '203.0.113.3')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect((await read(otherAdmin.accessToken, 'first', '203.0.113.1')).status).toBe(200)

    // Exhausted reads leave the write budget, and an exhausted write budget leaves reads.
    expect((await rename(admin.accessToken)).status).toBe(200)
    expect((await rename(admin.accessToken)).status).toBe(429)
    expect((await read(otherAdmin.accessToken, 'second', '203.0.113.10')).status).toBe(200)
  })

  test('rejects self-demotion and serializes concurrent cross-demotion', async () => {
    const first = await register('first-admin@example.com')
    const second = await register('second-admin@example.com')
    await prisma.user.updateMany({
      where: { id: { in: [first.user.id, second.user.id] } },
      data: { role: 'admin' },
    })

    const selfDemotion = await app.request(`/api/admin/users/${first.user.id}/role`, {
      method: 'PATCH',
      headers: authenticatedJsonHeaders(first.accessToken),
      body: JSON.stringify({ role: 'user' }),
    })
    expect(selfDemotion.status).toBe(409)

    const [firstDemotesSecond, secondDemotesFirst] = await Promise.all([
      app.request(`/api/admin/users/${second.user.id}/role`, {
        method: 'PATCH',
        headers: authenticatedJsonHeaders(first.accessToken),
        body: JSON.stringify({ role: 'user' }),
      }),
      app.request(`/api/admin/users/${first.user.id}/role`, {
        method: 'PATCH',
        headers: authenticatedJsonHeaders(second.accessToken),
        body: JSON.stringify({ role: 'user' }),
      }),
    ])

    const statuses = [firstDemotesSecond.status, secondDemotesFirst.status].sort()
    expect(statuses[0]).toBe(200)
    expect([401, 403]).toContain(statuses[1])
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(1)
  })

  test('seeds a locked admin idempotently and unlocks it only with an explicit password', async () => {
    await expect(assertLoginCapableAdmin(prisma)).rejects.toThrow(
      'password credential',
    )
    const localConfig = parseAdminSeedConfig({}, { requirePassword: false })
    expect(await bootstrapAdmin(prisma, localConfig)).toEqual({
      email: 'admin@example.com',
      locked: true,
    })
    const seeded = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@example.com' },
    })
    expect(seeded).toMatchObject({ passwordHash: null, role: 'admin' })
    await expect(assertLoginCapableAdmin(prisma)).rejects.toThrow(
      'password credential',
    )
    const lockedLogin = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'a-strong-local-admin-password',
      }),
    })
    expect(lockedLogin.status).toBe(401)

    await prisma.user.update({
      where: { id: seeded.id },
      data: { passwordHash: 'existing-hash' },
    })
    expect(await bootstrapAdmin(prisma, localConfig)).toEqual({
      email: 'admin@example.com',
      locked: false,
    })
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: seeded.id },
        select: { passwordHash: true },
      }),
    ).toEqual({ passwordHash: 'existing-hash' })

    const password = 'a-strong-local-admin-password'
    await bootstrapAdmin(
      prisma,
      parseAdminSeedConfig(
        {
          ADMIN_SEED_EMAIL: 'admin@example.com',
          ADMIN_SEED_PASSWORD: password,
        },
        { requirePassword: false },
      ),
    )
    const unlocked = await prisma.user.findUniqueOrThrow({
      where: { id: seeded.id },
      select: { passwordHash: true },
    })
    expect(unlocked.passwordHash).not.toBeNull()
    expect(await Bun.password.verify(password, unlocked.passwordHash!)).toBe(true)
    await expect(assertLoginCapableAdmin(prisma)).resolves.toBeUndefined()
  })

  test('concurrent first-admin bootstraps converge on one idempotent account', async () => {
    const config = {
      email: 'concurrent-bootstrap@example.com',
      password: null,
    }
    const results = await Promise.all([
      bootstrapAdmin(prisma, config),
      bootstrapAdmin(prisma, config),
    ])

    expect(results).toEqual([
      { email: config.email, locked: true },
      { email: config.email, locked: true },
    ])
    expect(await prisma.user.count({ where: { email: config.email } })).toBe(1)
    expect(await prisma.user.findUniqueOrThrow({
      where: { email: config.email },
      select: { passwordHash: true, role: true },
    })).toEqual({ passwordHash: null, role: 'admin' })
  })

  test('seeds login-ready development admin and user accounts idempotently', async () => {
    const accounts = {
      admin: {
        email: 'development-admin@example.com',
        password: 'development-admin-password',
      },
      user: {
        email: 'development-user@example.com',
        password: 'development-user-password',
      },
    }

    expect(await bootstrapDevelopmentData(prisma, accounts)).toEqual({
      admin: { email: accounts.admin.email, role: 'admin' },
      user: { email: accounts.user.email, role: 'user' },
    })

    await expect(bootstrapDevelopmentData(prisma, accounts)).resolves.toEqual({
      admin: { email: accounts.admin.email, role: 'admin' },
      user: { email: accounts.user.email, role: 'user' },
    })

    for (const [role, credentials] of Object.entries(accounts)) {
      const response = await app.request('/api/auth/token/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.user.role).toBe(role)
    }

    // Uncomment with the billing tables (docs/IAP.md): the demo seed must grant no entitlement.
    // expect(await prisma.subscriptionEntitlement.count()).toBe(0)
  })

  test('replaces development user credentials and revokes stale authentication state', async () => {
    const accounts = {
      admin: {
        email: 'rotated-development-admin@example.com',
        password: 'rotated-development-admin-password',
      },
      user: {
        email: 'rotated-development-user@example.com',
        password: 'initial-development-user-password',
      },
    }
    await bootstrapDevelopmentData(prisma, accounts)

    const login = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(accounts.user),
    })
    expect(login.status).toBe(200)
    const session = await login.json()
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: accounts.user.email },
      select: { id: true },
    })
    const storedSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: user.id, revokedAt: null },
      select: { id: true },
    })
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[development-user-password-rotation]',
        registrationSessionId: storedSession.id,
        userId: user.id,
      },
    })
    const resetToken = 'd'.repeat(43)
    await createOutstandingPasswordResetToken(user.id, resetToken)

    const replacementPassword = 'replacement-development-user-password'
    await bootstrapDevelopmentData(prisma, {
      ...accounts,
      user: { ...accounts.user, password: replacementPassword },
    })

    expect(await app.request('/api/auth/me', {
      headers: authenticatedHeaders(session.accessToken),
    })).toHaveProperty('status', 401)
    await expectPasswordResetRejected(resetToken)
    expect(await prisma.pushToken.count({ where: { userId: user.id } })).toBe(0)

    const oldPasswordLogin = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(accounts.user),
    })
    expect(oldPasswordLogin.status).toBe(401)
    const replacementPasswordLogin = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...accounts.user, password: replacementPassword }),
    })
    expect(replacementPasswordLogin.status).toBe(200)
  })

  test('revokes existing sessions and push registrations when bootstrap changes privileges or credentials', async () => {
    const existing = await register('bootstrap-existing@example.com')
    const initialSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: existing.user.id },
      select: { id: true },
    })
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[bootstrap-promotion]',
        registrationSessionId: initialSession.id,
        userId: existing.user.id,
      },
    })
    const resetTokenBeforeBootstrap = 'b'.repeat(43)
    await createOutstandingPasswordResetToken(existing.user.id, resetTokenBeforeBootstrap)

    await bootstrapAdmin(prisma, {
      email: existing.user.email,
      password: null,
    })

    expect(await app.request('/api/auth/me', {
      headers: authenticatedHeaders(existing.accessToken),
    })).toHaveProperty('status', 401)
    await expectPasswordResetRejected(resetTokenBeforeBootstrap)
    expect(await prisma.user.findUniqueOrThrow({
      where: { id: existing.user.id },
      select: { role: true },
    })).toEqual({ role: 'admin' })
    expect(await prisma.pushToken.count({ where: { userId: existing.user.id } })).toBe(0)

    const relogin = await login(existing.user.email)
    const reloginSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: existing.user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[bootstrap-password-reset]',
        registrationSessionId: reloginSession.id,
        userId: existing.user.id,
      },
    })
    const replacementPassword = 'replacement-admin-password'

    await bootstrapAdmin(prisma, {
      email: existing.user.email,
      password: replacementPassword,
    })

    expect(await app.request('/api/auth/me', {
      headers: authenticatedHeaders(relogin.accessToken),
    })).toHaveProperty('status', 401)
    expect(await prisma.pushToken.count({ where: { userId: existing.user.id } })).toBe(0)
    const oldPasswordLogin = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: existing.user.email,
        password: 'password123',
      }),
    })
    expect(oldPasswordLogin.status).toBe(401)
    const replacementPasswordLogin = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: existing.user.email,
        password: replacementPassword,
      }),
    })
    expect(replacementPasswordLogin.status).toBe(200)
    const replacementSession = await replacementPasswordLogin.json()
    const replacementSessionId = await prisma.authSession.findFirstOrThrow({
      where: { userId: existing.user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    await prisma.pushToken.create({
      data: {
        expoPushToken: 'ExponentPushToken[bootstrap-idempotent-password]',
        registrationSessionId: replacementSessionId.id,
        userId: existing.user.id,
      },
    })


    await bootstrapAdmin(prisma, {
      email: existing.user.email,
      password: replacementPassword,
    })
    expect(await app.request('/api/auth/me', {
      headers: authenticatedHeaders(replacementSession.accessToken),
    })).toHaveProperty('status', 200)
    expect(await prisma.pushToken.count({ where: { userId: existing.user.id } })).toBe(1)
  })

  function createOutstandingPasswordResetToken(userId: string, token: string) {
    return prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
      },
    })
  }

  async function expectPasswordResetRejected(token: string) {
    const response = await app.request('/api/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'late-reset-password' }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('AUTH_PASSWORD_RESET_INVALID')
  }

  async function register(email: string, displayName?: string) {
    const response = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'password123',
        displayName,
      }),
    })
    expect(response.status).toBe(201)
    return response.json()
  }

  async function login(email: string) {
    const response = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'password123',
      }),
    })
    expect(response.status).toBe(200)
    return response.json()
  }
})

function authenticatedHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  }
}

function authenticatedJsonHeaders(accessToken: string) {
  return {
    ...authenticatedHeaders(accessToken),
    'Content-Type': 'application/json',
  }
}
