import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { createApp } from '../app'
import { createPrisma, type DbClient } from '../db'
import { loadEnv } from '../env'
import { runBackgroundJob } from '../jobs'
import type { BackendRuntime } from '../runtime'
import { createDatabaseRateLimitStore } from './database-store'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

/**
 * The database store exists for one reason: several backend processes that never see each other
 * must still agree on one budget per client. A faked `$queryRaw` cannot prove that - the upsert's
 * conflict target, the window alignment and the timestamp round-trip are all PostgreSQL behaviour,
 * so every test here runs two clients against the real thing.
 */
maybeDescribe('database rate-limit store', () => {
  const clients: DbClient[] = []
  const newClient = () => {
    const client = createPrisma(databaseUrl!)
    clients.push(client)
    return client
  }
  const prisma = newClient()

  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany()
  })

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()))
  })

  test('two processes bump one counter for the same policy and key', async () => {
    const first = createDatabaseRateLimitStore(newClient(), 'auth')
    const second = createDatabaseRateLimitStore(newClient(), 'auth')
    const now = Date.UTC(2026, 8, 12, 10, 0, 17, 500)
    const resetAt = Date.UTC(2026, 8, 12, 10, 1)

    expect(await first.consume('203.0.113.10', 60, now)).toEqual({ count: 1, resetAt })
    expect(await second.consume('203.0.113.10', 60, now + 1_000)).toEqual({ count: 2, resetAt })
    expect(await first.consume('203.0.113.10', 60, now + 2_000)).toEqual({ count: 3, resetAt })
  })

  test('policies, keys and windows each get their own counter', async () => {
    const auth = createDatabaseRateLimitStore(prisma, 'auth')
    const account = createDatabaseRateLimitStore(prisma, 'account')
    const now = Date.UTC(2026, 8, 12, 10, 0, 59, 999)

    await auth.consume('203.0.113.10', 60, now)

    expect((await account.consume('203.0.113.10', 60, now)).count).toBe(1)
    expect((await auth.consume('203.0.113.11', 60, now)).count).toBe(1)
    // One millisecond later the window has rolled over, and the counter with it. Windows are
    // aligned to the clock rather than to the first request, because that is the only way two
    // processes can name the same bucket without talking to each other first.
    expect(await auth.consume('203.0.113.10', 60, now + 1)).toEqual({
      count: 1,
      resetAt: Date.UTC(2026, 8, 12, 10, 2),
    })
  })

  test('a bucket row records the window it counts and when it stops mattering', async () => {
    // The row is what the cleanup job and every peer process read, so the instants written by the
    // raw upsert have to come back through Prisma unchanged - a timezone slip here would make the
    // sweeper delete live windows or keep dead ones forever.
    const store = createDatabaseRateLimitStore(prisma, 'auth')

    await store.consume('203.0.113.10', 60, Date.UTC(2026, 8, 12, 10, 0, 17))

    expect(await prisma.rateLimitBucket.findMany()).toEqual([
      {
        policy: 'auth',
        key: '203.0.113.10',
        windowStart: new Date(Date.UTC(2026, 8, 12, 10, 0)),
        count: 1,
        expiresAt: new Date(Date.UTC(2026, 8, 12, 10, 1)),
      },
    ])
  })
})

maybeDescribe('auth rate limits across backend processes', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '2',
    // Windows are aligned to the wall clock, so a default 60 s window could roll over between two
    // of the requests below and hand the second half a fresh budget. An hour cannot.
    AUTH_RATE_LIMIT_WINDOW_SECONDS: '3600',
    RATE_LIMIT_STORE: 'database',
    TRUST_PROXY: 'true',
    TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-forwarded-for',
  })
  const prisma = createPrisma(databaseUrl!)
  const peerPrisma = createPrisma(databaseUrl!)
  // Two apps over two connections: the closest a test gets to two serverless container instances
  // that share nothing but the database.
  const apps = [createApp({ env, prisma }), createApp({ env, prisma: peerPrisma })] as const

  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany()
  })

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), peerPrisma.$disconnect()])
  })

  test('two backend processes enforce one combined budget for one client', async () => {
    const register = (app: (typeof apps)[number], clientIp: string) =>
      app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': clientIp },
        body: JSON.stringify({ email: 'invalid', password: 'short' }),
      })

    expect((await register(apps[0], '203.0.113.10')).status).toBe(400)
    expect((await register(apps[1], '203.0.113.10')).status).toBe(400)

    const limited = await register(apps[0], '203.0.113.10')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect((await register(apps[1], '203.0.113.10')).status).toBe(429)
    // Another client is still on its own budget, on either process.
    expect((await register(apps[1], '203.0.113.11')).status).toBe(400)
  })

  test('auth:sessions:cleanup drops spent windows and keeps the one still counting', async () => {
    const store = createDatabaseRateLimitStore(prisma, 'auth')
    const now = Date.UTC(2026, 8, 12, 3, 0, 10)
    await store.consume('spent', 60, now - 70_000)
    await store.consume('live', 60, now)
    const log = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runBackgroundJob('auth:sessions:cleanup', { env, prisma } as BackendRuntime, new Date(now))
    } finally {
      log.mockRestore()
    }

    expect((await prisma.rateLimitBucket.findMany()).map((row) => row.key)).toEqual(['live'])
  })
})
