import { createHash } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import {
  createPrisma,
  type DbClient,
  userAuthenticationSessionTransactionOptions,
  userAuthorityTransitionTransactionOptions,
} from '../../db'
import { loadEnv } from '../../env'
import {
  assertLoginCapableAdmin,
  bootstrapAdmin,
  parseAdminSeedConfig,
} from './infrastructure/admin-bootstrap'
import { bootstrapDevelopmentData } from '../../../scripts/development-seed'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

/**
 * The keys `db.ts` hands to `pg_advisory_xact_lock`, repeated here rather than exported: they are
 * an implementation detail of the locks, and a test that has to know them should be the only
 * other place that does. A rename there means no lock request is ever recognised: the observed
 * operation still queues on the real lock, so the test fails only once the gated holder's
 * transaction has expired, 15-20 s in, on whatever that expiry surfaces as - a 500, a rejected
 * bootstrap, or the ordering flag - rather than promptly on the ordering it meant to check.
 */
const userRoleMutationLockKey = 'user-role-mutations'
const userAuthenticationAuthorityLockKey = (userId: string) => `auth-authority:${userId}`

maybeDescribe('users and admin API integration', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: 'http://localhost:5173',
    // Short enough that a test can observe an access token expiring.
    ACCESS_TOKEN_TTL_SECONDS: '60',
  })
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
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

  test('keeps queued role transitions from blocking unrelated target logins', async () => {
    const actor = await register('queue-actor@example.com')
    await prisma.user.update({
      where: { id: actor.user.id },
      data: { role: 'admin' },
    })
    const firstTarget = await register('queue-first@example.com')
    const secondTarget = await register('queue-second@example.com')
    const thirdTarget = await register('queue-third@example.com')

    const firstUpdateGate = gateNextUserUpdate(firstTarget.user.id)
    const firstRoleApp = createApp({ env, prisma: firstUpdateGate.db })
    // Resolves once both later role changes have asked for the global role lock the first one is
    // holding: from then on they are queued behind it, whatever the machine's pace.
    const roleLockQueue = observeAdvisoryLockRequests(userRoleMutationLockKey, 2)
    const queuedRoleApp = createApp({ env, prisma: roleLockQueue.db })
    const promote = (targetId: string, requestApp: typeof app) =>
      requestApp.request(`/api/admin/users/${targetId}/role`, {
        method: 'PATCH',
        headers: authenticatedJsonHeaders(actor.accessToken),
        body: JSON.stringify({ role: 'admin' }),
      })

    const firstRoleChange = promote(firstTarget.user.id, firstRoleApp)
    await firstUpdateGate.reached

    let secondRoleSettled = false
    let thirdRoleSettled = false
    const secondRoleChange = Promise.resolve(promote(secondTarget.user.id, queuedRoleApp)).finally(() => {
      secondRoleSettled = true
    })
    const thirdRoleChange = Promise.resolve(promote(thirdTarget.user.id, queuedRoleApp)).finally(() => {
      thirdRoleSettled = true
    })
    // Raced against the role changes themselves so that a role change which no longer takes the
    // lock fails the queued assertion below instead of leaving this wait to the test timeout.
    await Promise.race([roleLockQueue.requested, secondRoleChange, thirdRoleChange])

    const loginRequest = (email: string) =>
      app.request('/api/auth/token/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123' }),
      })
    // Awaited while the first role change still holds the queue: a login that had to wait for its
    // target's queued role change could not answer before the gate below is released.
    const loginResponses = await Promise.all([
      loginRequest(secondTarget.user.email),
      loginRequest(thirdTarget.user.email),
    ])

    const roleChangesWereQueued = !secondRoleSettled && !thirdRoleSettled
    firstUpdateGate.release()
    const roleResponses = await Promise.all([
      firstRoleChange,
      secondRoleChange,
      thirdRoleChange,
    ])

    expect(roleChangesWereQueued).toBe(true)
    expect(loginResponses.map(({ status }) => status)).toEqual([200, 200])
    expect(roleResponses.map(({ status }) => status)).toEqual([200, 200, 200])
  })

  test('makes an old-password login wait out a bootstrap that owns authentication authority', async () => {
    const existing = await register('bootstrap-reset-wins@example.com')
    const userUpdateGate = gateNextUserUpdate(existing.user.id)
    const reset = bootstrapAdmin(userUpdateGate.db, {
      email: existing.user.email,
      password: 'new-bootstrap-password',
    })
    await userUpdateGate.reached

    // The login has to queue on the lock the bootstrap holds, and its transaction has to be
    // allowed to wait longer than an authority transition may run - otherwise it would die on
    // Prisma's timeout instead of answering against the credential the bootstrap installs.
    const authorityLock = observeAdvisoryLockRequests(
      userAuthenticationAuthorityLockKey(existing.user.id),
    )
    const loginTransactions = recordTransactionOptions(authorityLock.db)
    const loginApp = createApp({ env, prisma: loginTransactions.db })
    let loginSettled = false
    const oldPasswordLogin = Promise.resolve(loginApp.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: existing.user.email,
        password: 'password123',
      }),
    })).finally(() => {
      loginSettled = true
    })
    // Raced against the login so that a login which no longer takes the lock is caught by the
    // settled flag below instead of leaving this wait to the test timeout.
    await Promise.race([authorityLock.requested, oldPasswordLogin])
    const loginSettledBeforeReset = loginSettled
    userUpdateGate.release()

    const [, loginResponse] = await Promise.all([reset, oldPasswordLogin])
    expect(loginSettledBeforeReset).toBe(false)
    expect(loginTransactions.options).toEqual([userAuthenticationSessionTransactionOptions])
    expect(userAuthenticationSessionTransactionOptions.timeout).toBeGreaterThan(
      userAuthorityTransitionTransactionOptions.timeout,
    )
    expect(loginResponse.status).toBe(401)
  })

  test('revokes a password login that wins session issuance before bootstrap reset', async () => {
    const existing = await register('login-before-bootstrap-reset@example.com')
    const sessionCreateGate = gateNextSessionCreate()
    const loginApp = createApp({ env, prisma: sessionCreateGate.db })
    const login = loginApp.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: existing.user.email,
        password: 'password123',
      }),
    })
    await sessionCreateGate.reached

    const authorityLock = observeAdvisoryLockRequests(
      userAuthenticationAuthorityLockKey(existing.user.id),
    )
    let resetSettled = false
    const reset = bootstrapAdmin(authorityLock.db, {
      email: existing.user.email,
      password: 'newer-bootstrap-password',
    }).finally(() => {
      resetSettled = true
    })
    // The bootstrap has asked for the lock the login's transaction holds, so it is queued. Raced
    // against the bootstrap so that one which no longer takes the lock is caught by the settled
    // flag below instead of leaving this wait to the test timeout.
    await Promise.race([authorityLock.requested, reset])
    const resetSettledBeforeLogin = resetSettled
    sessionCreateGate.release()

    const [loginResponse] = await Promise.all([login, reset])
    const loginBody = await loginResponse.json()
    expect(loginResponse.status).toBe(200)
    expect(resetSettledBeforeLogin).toBe(false)
    expect(await app.request('/api/auth/me', {
      headers: authenticatedHeaders(loginBody.accessToken),
    })).toHaveProperty('status', 401)
  })

  test('issues a fresh-role login when role mutation owns authentication authority first', async () => {
    const admin = await register('role-first-admin@example.com')
    await prisma.user.update({
      where: { id: admin.user.id },
      data: { role: 'admin' },
    })
    const target = await register('role-first-target@example.com')
    const userUpdateGate = gateNextUserUpdate(target.user.id)
    const roleApp = createApp({ env, prisma: userUpdateGate.db })
    const roleChange = roleApp.request(`/api/admin/users/${target.user.id}/role`, {
      method: 'PATCH',
      headers: authenticatedJsonHeaders(admin.accessToken),
      body: JSON.stringify({ role: 'admin' }),
    })
    await userUpdateGate.reached

    const authorityLock = observeAdvisoryLockRequests(
      userAuthenticationAuthorityLockKey(target.user.id),
    )
    const loginApp = createApp({ env, prisma: authorityLock.db })
    let loginSettled = false
    const targetLogin = Promise.resolve(loginApp.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: target.user.email,
        password: 'password123',
      }),
    })).finally(() => {
      loginSettled = true
    })
    // The login has asked for the lock the role change holds, so it is queued behind it. Raced
    // against the login so that one which no longer takes the lock is caught by the settled flag
    // below instead of leaving this wait to the test timeout.
    await Promise.race([authorityLock.requested, targetLogin])
    const loginSettledBeforeRoleChange = loginSettled
    userUpdateGate.release()

    const [roleResponse, loginResponse] = await Promise.all([roleChange, targetLogin])
    const loginBody = await loginResponse.json()
    expect(roleResponse.status).toBe(200)
    expect(loginSettledBeforeRoleChange).toBe(false)
    expect(loginResponse.status).toBe(200)
    expect(loginBody.user.role).toBe('admin')
    expect(await app.request('/api/auth/me', {
      headers: authenticatedHeaders(loginBody.accessToken),
    })).toHaveProperty('status', 200)
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
    const firstHashes = await prisma.user.findMany({
      where: { email: { in: [accounts.admin.email, accounts.user.email] } },
      orderBy: { email: 'asc' },
      select: { email: true, passwordHash: true },
    })

    await expect(bootstrapDevelopmentData(prisma, accounts)).resolves.toEqual({
      admin: { email: accounts.admin.email, role: 'admin' },
      user: { email: accounts.user.email, role: 'user' },
    })
    expect(await prisma.user.findMany({
      where: { email: { in: [accounts.admin.email, accounts.user.email] } },
      orderBy: { email: 'asc' },
      select: { email: true, passwordHash: true },
    })).toEqual(firstHashes)

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
  })

  test('concurrent first development seeds converge on one admin and user', async () => {
    const accounts = {
      admin: {
        email: 'concurrent-development-admin@example.com',
        password: 'concurrent-development-admin-password',
      },
      user: {
        email: 'concurrent-development-user@example.com',
        password: 'concurrent-development-user-password',
      },
    }
    let userReads = 0
    let markBothUserReadsComplete: () => void = () => undefined
    const bothUserReadsComplete = new Promise<void>((resolve) => {
      markBothUserReadsComplete = resolve
    })
    let releaseUserReads: () => void = () => undefined
    const userReadBarrier = new Promise<void>((resolve) => {
      releaseUserReads = resolve
    })
    const db = prisma.$extends({
      query: {
        user: {
          async findUnique({ args, query }) {
            const result = await query(args)
            if (args.where.email === accounts.user.email && userReads < 2) {
              userReads += 1
              if (userReads === 2) markBothUserReadsComplete()
              await userReadBarrier
            }
            return result
          },
        },
      },
    }) as unknown as DbClient

    const firstSeed = bootstrapDevelopmentData(db, accounts)
    const secondSeed = bootstrapDevelopmentData(db, accounts)
    await bothUserReadsComplete
    releaseUserReads()

    await expect(Promise.all([firstSeed, secondSeed])).resolves.toEqual([
      {
        admin: { email: accounts.admin.email, role: 'admin' },
        user: { email: accounts.user.email, role: 'user' },
      },
      {
        admin: { email: accounts.admin.email, role: 'admin' },
        user: { email: accounts.user.email, role: 'user' },
      },
    ])
    expect(await prisma.user.count({
      where: { email: { in: [accounts.admin.email, accounts.user.email] } },
    })).toBe(2)
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

  test('revokes existing sessions when bootstrap changes privileges or credentials', async () => {
    const existing = await register('bootstrap-existing@example.com')
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

    const relogin = await login(existing.user.email)
    const replacementPassword = 'replacement-admin-password'

    await bootstrapAdmin(prisma, {
      email: existing.user.email,
      password: replacementPassword,
    })

    expect(await app.request('/api/auth/me', {
      headers: authenticatedHeaders(relogin.accessToken),
    })).toHaveProperty('status', 401)
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
    const hashBeforeIdempotentSeed = await prisma.user.findUniqueOrThrow({
      where: { id: existing.user.id },
      select: { passwordHash: true },
    })

    await bootstrapAdmin(prisma, {
      email: existing.user.email,
      password: replacementPassword,
    })

    expect(await prisma.user.findUniqueOrThrow({
      where: { id: existing.user.id },
      select: { passwordHash: true },
    })).toEqual(hashBeforeIdempotentSeed)
    expect(await app.request('/api/auth/me', {
      headers: authenticatedHeaders(replacementSession.accessToken),
    })).toHaveProperty('status', 200)
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

  function gateNextSessionCreate() {
    let markReached: () => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      markReached = resolve
    })
    let releaseGate: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    let gated = false
    const db = prisma.$extends({
      query: {
        authSession: {
          async create({ args, query }) {
            if (!gated) {
              gated = true
              markReached()
              await barrier
            }
            return query(args)
          },
        },
      },
    }) as unknown as DbClient
    return { db, reached, release: releaseGate }
  }

  function gateNextUserUpdate(userId: string) {
    let markReached: () => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      markReached = resolve
    })
    let releaseGate: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    let gated = false
    const db = prisma.$extends({
      query: {
        user: {
          async update({ args, query }) {
            const updated = await query(args)
            if (!gated && args.where.id === userId) {
              gated = true
              markReached()
              await barrier
            }
            return updated
          },
        },
      },
    }) as unknown as DbClient
    return { db, reached, release: releaseGate }
  }

  /**
   * Resolves once `count` transactions on the returned client have asked PostgreSQL for the
   * named advisory lock. The statement itself is left alone, so a lock someone else holds still
   * blocks the caller: what the test learns is that the caller has reached the wait, without
   * guessing how long it took to get there.
   */
  function observeAdvisoryLockRequests(lockKey: string, count = 1) {
    let markRequested: () => void = () => undefined
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve
    })
    let seen = 0
    const db = prisma.$extends({
      query: {
        $executeRaw({ args, query }) {
          if (isAdvisoryLockRequest(args, lockKey)) {
            seen += 1
            if (seen === count) markRequested()
          }
          return query(args)
        },
      },
    }) as unknown as DbClient
    return { db, requested }
  }

  /** The options of every `$transaction` opened through the returned client, in call order. */
  function recordTransactionOptions(db: DbClient) {
    const options: unknown[] = []
    const recording = new Proxy(db, {
      get(target, property) {
        if (property === '$transaction') {
          return (...args: unknown[]) => {
            options.push(args[1])
            return Reflect.apply(target.$transaction, target, args)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    return { db: recording, options }
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

/**
 * A `$executeRaw` statement taking the advisory lock keyed `lockKey`. `db.ts` writes one key
 * inline and binds the other as a parameter, so both places are checked.
 */
function isAdvisoryLockRequest(statement: unknown, lockKey: string) {
  const { sql, values } = statement as { sql?: string; values?: unknown[] }
  if (sql?.includes('pg_advisory_xact_lock') !== true) return false
  return sql.includes(`'${lockKey}'`) || values?.includes(lockKey) === true
}
