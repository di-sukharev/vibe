import { expect, test } from 'bun:test'
import { SignJWT } from 'jose'

import type { DbClient } from './db'
import { loadEnv } from './env'
import { createApp } from './app'

const env = loadEnv({
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
})

async function createAdminDirectoryTestApp({
  readLimitMax = 120,
  writeLimitMax = 60,
}: {
  readLimitMax?: number
  writeLimitMax?: number
} = {}) {
  type TestAdmin = {
    createdAt: Date
    displayName: string | null
    email: string
    id: string
    passwordHash: null
    role: 'admin'
  }
  const primaryAdmin: TestAdmin = {
    id: '0196f6f8-6600-7000-8000-000000000001',
    email: 'admin@example.com',
    passwordHash: null,
    displayName: 'Admin',
    role: 'admin' as const,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
  const secondaryAdmin: TestAdmin = {
    ...primaryAdmin,
    id: '0196f6f8-6600-7000-8000-000000000002',
    email: 'second-admin@example.com',
    displayName: 'Second Admin',
  }
  const users = new Map([
    [primaryAdmin.id, primaryAdmin],
    [secondaryAdmin.id, secondaryAdmin],
  ])
  const sessions = new Map([
    ['session-1', { id: 'session-1', userId: primaryAdmin.id, user: primaryAdmin }],
    ['session-2', { id: 'session-2', userId: primaryAdmin.id, user: primaryAdmin }],
    ['session-3', { id: 'session-3', userId: secondaryAdmin.id, user: secondaryAdmin }],
  ])
  let listUsersCalls = 0
  const prisma = {
    authSession: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
        const session = sessions.get(where.id)
        return session?.userId === where.userId ? session : null
      },
    },
    subscriptionEntitlement: {
      findUnique: async () => null,
    },
    user: {
      count: async () => users.size,
      findMany: async () => {
        listUsersCalls += 1
        return [...users.values()]
      },
      update: async ({
        data,
        where,
      }: {
        data: { displayName: string | null }
        where: { id: string }
      }) => {
        const user = users.get(where.id)
        if (!user) throw new Error('test user not found')
        const updated = { ...user, ...data }
        users.set(where.id, updated)
        return updated
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  } as unknown as DbClient
  const appEnv = {
    ...env,
    ADMIN_USERS_READ_RATE_LIMIT_MAX: readLimitMax,
    AUTH_RATE_LIMIT_MAX: writeLimitMax,
    TRUST_PROXY: true,
    TRUSTED_PROXY_CLIENT_IP_HEADER: 'do-connecting-ip',
    TRUSTED_PROXY_CLIENT_IP_POSITION: 'first' as const,
  }
  const signForSession = (sessionId: string, admin: typeof primaryAdmin) =>
    new SignJWT({ email: admin.email, sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(admin.id)
      .setIssuedAt()
      .setExpirationTime(`${appEnv.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(new TextEncoder().encode(appEnv.JWT_SECRET))
  const tokens = {
    primary: await Promise.all([
      signForSession('session-1', primaryAdmin),
      signForSession('session-2', primaryAdmin),
    ]),
    secondary: [await signForSession('session-3', secondaryAdmin)],
  }

  return {
    app: createApp({ env: appEnv, prisma }),
    get listUsersCalls() {
      return listUsersCalls
    },
    tokens,
  }
}

test('liveness is process-only while readiness checks the database', async () => {
  let databaseAvailable = true
  const prisma = {
    $queryRaw: async () => {
      if (!databaseAvailable) throw new Error('database unavailable')
      return [{ '?column?': 1 }]
    },
  } as unknown as DbClient
  const app = createApp({ env, prisma })

  expect((await app.request('/health/live')).status).toBe(200)
  expect((await app.request('/health/ready')).status).toBe(200)

  databaseAvailable = false

  expect((await app.request('/health/live')).status).toBe(200)
  expect((await app.request('/health/ready')).status).toBe(503)
})

test('CORS preflight allows the standard mutation methods exposed by the client transport', async () => {
  const prisma = { $queryRaw: async () => [{ '?column?': 1 }] } as unknown as DbClient
  const app = createApp({ env, prisma })
  const response = await app.request('/api/future-resource', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'PATCH',
    },
  })

  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-methods')).toContain('PATCH')
})

test('App Store webhook ingress rejects oversized bodies before billing work', async () => {
  const app = createApp({
    env: { ...env, WEBHOOK_BODY_LIMIT_BYTES: 32 },
    prisma: {} as DbClient,
  })
  const response = await app.request('/api/webhooks/app-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedPayload: 'x'.repeat(64) }),
  })

  expect(response.status).toBe(413)
})

test('App Store webhook ingress has an independent bounded request rate', async () => {
  const app = createApp({
    env: { ...env, WEBHOOK_RATE_LIMIT_MAX: 1 },
    prisma: {} as DbClient,
  })
  const request = () => app.request('/api/webhooks/app-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })

  expect((await request()).status).not.toBe(429)
  const limited = await request()
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBeTruthy()
})

test('IAP ingress rejects oversized bodies before authentication and validation', async () => {
  const app = createApp({
    env: { ...env, IAP_BODY_LIMIT_BYTES: 32 },
    prisma: {} as DbClient,
  })
  const response = await app.request('/api/iap/app-store/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTransactionInfo: 'x'.repeat(64) }),
  })

  expect(response.status).toBe(413)
})

test('IAP ingress has an independent bounded request rate', async () => {
  const app = createApp({
    env: { ...env, IAP_RATE_LIMIT_MAX: 1 },
    prisma: {} as DbClient,
  })
  const request = () => app.request('/api/iap/app-store/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTransactionInfo: 'signed-transaction' }),
  })

  expect((await request()).status).not.toBe(429)
  const limited = await request()
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBeTruthy()
})

test('account mutations reject oversized bodies before authentication', async () => {
  const app = createApp({
    env: { ...env, AUTH_BODY_LIMIT_BYTES: 32 },
    prisma: {} as DbClient,
  })
  const request = (path: string) => app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'x'.repeat(64), role: 'admin' }),
  })

  expect((await request('/api/users/me')).status).toBe(413)
  expect((await request('/api/admin/users/0196f6f8-6600-7000-8000-000000000001/role')).status)
    .toBe(413)
})

test('account mutations share bounded write-rate protection', async () => {
  const app = createApp({
    env: { ...env, AUTH_RATE_LIMIT_MAX: 1 },
    prisma: {} as DbClient,
  })
  const request = (path: string) => app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })

  expect((await request('/api/users/me')).status).toBe(401)
  const limited = await request(
    '/api/admin/users/0196f6f8-6600-7000-8000-000000000001/role',
  )
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBeTruthy()
})

test('admin user reads share one bounded budget across filters, sessions, and client addresses', async () => {
  const readLimitMax = 120
  const harness = await createAdminDirectoryTestApp({ readLimitMax })
  const statuses: number[] = []
  let firstLimited: Response | undefined

  for (let index = 0; index < 500; index += 1) {
    const response = await harness.app.request(`/api/admin/users?q=user-${index}`, {
      headers: {
        Authorization: `Bearer ${harness.tokens.primary[index % harness.tokens.primary.length]}`,
        'Do-Connecting-Ip': `203.0.113.${index % 200 + 1}`,
      },
    })
    statuses.push(response.status)
    if (response.status === 429 && !firstLimited) firstLimited = response
  }

  expect(statuses.filter((status) => status === 200)).toHaveLength(readLimitMax)
  expect(statuses.filter((status) => status === 429)).toHaveLength(500 - readLimitMax)
  expect(harness.listUsersCalls).toBe(readLimitMax)
  expect(firstLimited?.headers.get('retry-after')).toBeTruthy()
})

test('admin user read budgets are isolated by administrator', async () => {
  const harness = await createAdminDirectoryTestApp({ readLimitMax: 1 })
  const request = (token: string) => harness.app.request('/api/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
  })

  expect((await request(harness.tokens.primary[0]!)).status).toBe(200)
  expect((await request(harness.tokens.primary[1]!)).status).toBe(429)
  expect((await request(harness.tokens.secondary[0]!)).status).toBe(200)
})

test('admin user reads and account mutations use independent budgets', async () => {
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Do-Connecting-Ip': '203.0.113.10',
  })
  const readsFirst = await createAdminDirectoryTestApp({
    readLimitMax: 1,
    writeLimitMax: 1,
  })
  const readsFirstToken = readsFirst.tokens.primary[0]!

  expect((await readsFirst.app.request('/api/admin/users', {
    headers: headers(readsFirstToken),
  })).status).toBe(200)
  expect((await readsFirst.app.request('/api/admin/users', {
    headers: headers(readsFirstToken),
  })).status).toBe(429)
  expect((await readsFirst.app.request('/api/users/me', {
    method: 'PATCH',
    headers: headers(readsFirstToken),
    body: JSON.stringify({ displayName: 'Still Admin' }),
  })).status).toBe(200)

  const writesFirst = await createAdminDirectoryTestApp({
    readLimitMax: 1,
    writeLimitMax: 1,
  })
  const writesFirstToken = writesFirst.tokens.primary[0]!

  expect((await writesFirst.app.request('/api/users/me', {
    method: 'PATCH',
    headers: headers(writesFirstToken),
    body: JSON.stringify({ displayName: 'Still Admin' }),
  })).status).toBe(200)
  expect((await writesFirst.app.request('/api/users/me', {
    method: 'PATCH',
    headers: headers(writesFirstToken),
    body: JSON.stringify({ displayName: 'Admin Again' }),
  })).status).toBe(429)
  expect((await writesFirst.app.request('/api/admin/users', {
    headers: headers(writesFirstToken),
  })).status).toBe(200)
})

test('OpenAPI documents account mutation ingress failures', async () => {
  const prisma = { $queryRaw: async () => [{ '?column?': 1 }] } as unknown as DbClient
  const app = createApp({ env, prisma })
  const response = await app.request('/openapi.json')
  const document = await response.json() as {
    components?: {
      securitySchemes?: Record<string, unknown>
    }
    paths: Record<string, {
      get?: {
        responses: Record<string, unknown>
        security?: Array<Record<string, unknown>>
      }
      patch?: {
        responses: Record<string, unknown>
        security?: Array<Record<string, unknown>>
      }
    }>
  }

  expect(response.status).toBe(200)
  expect(document.components?.securitySchemes).toHaveProperty('BearerAuth')
  expect(document.paths['/api/auth/me']?.get?.security).toEqual([
    { BearerAuth: [] },
  ])
  expect(document.paths['/api/users/me']?.patch?.security).toEqual([
    { BearerAuth: [] },
  ])
  expect(document.paths['/api/admin/dashboard']?.get?.security).toEqual([
    { BearerAuth: [] },
  ])
  expect(document.paths['/api/admin/users']?.get?.security).toEqual([
    { BearerAuth: [] },
  ])
  expect(document.paths['/api/admin/users']?.get?.responses).toHaveProperty('429')
  expect(document.paths['/api/users/me']?.patch?.responses).toHaveProperty('413')
  expect(document.paths['/api/users/me']?.patch?.responses).toHaveProperty('429')
  expect(document.paths['/api/admin/users/{userId}/role']?.patch?.responses)
    .toHaveProperty('413')
  expect(document.paths['/api/admin/users/{userId}/role']?.patch?.responses)
    .toHaveProperty('429')
  expect(document.paths['/api/admin/users/{userId}/role']?.patch?.security).toEqual([
    { BearerAuth: [] },
  ])
})
