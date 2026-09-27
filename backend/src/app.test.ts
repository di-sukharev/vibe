import { expect, test } from 'bun:test'

import type { DbClient } from './db'
import { loadEnv } from './env'
import { createApp } from './app'

const env = loadEnv({
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
})

function createHealthTestApp({ databaseAvailable }: { databaseAvailable: boolean }) {
  let queries = 0
  const prisma = {
    $queryRaw: async () => {
      queries += 1
      // Yield once so concurrent probes overlap the way a real round-trip would.
      await Promise.resolve()
      if (!databaseAvailable) throw new Error('database unavailable')
      return [{ '?column?': 1 }]
    },
  } as unknown as DbClient

  return {
    app: createApp({ env, prisma }),
    get queries() {
      return queries
    },
  }
}

test('readiness probes share one database query, up or down, while liveness never touches it', async () => {
  // `/health/ready` sits outside every rate limiter, so a GET flood must not turn into a flood of
  // pool connections. `http/readiness.test.ts` owns the window arithmetic; this proves the wiring:
  // N overlapping probes, and the next one inside the window, cost one query and share one answer.
  for (const [databaseAvailable, status] of [[true, 200], [false, 503]] as const) {
    const harness = createHealthTestApp({ databaseAvailable })
    const probes = 25

    const responses = await Promise.all(
      Array.from({ length: probes }, () => harness.app.request('/health/ready')),
    )

    expect(responses.map((response) => response.status)).toEqual(Array(probes).fill(status))
    expect((await harness.app.request('/health/ready')).status).toBe(status)
    expect((await harness.app.request('/health/live')).status).toBe(200)
    expect((await harness.app.request('/health')).status).toBe(200)
    expect(harness.queries).toBe(1)
  }
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
// `/api/future-resource` stands for the next feature's routes: they get the limits without an edit.
test('API writes reject oversized bodies before authentication', async () => {
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
  expect((await request('/api/future-resource')).status).toBe(413)
})

test('API writes outside sign-in share one bounded write-rate budget', async () => {
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
  expect((await request('/api/future-resource')).status).toBe(429)

  const signUp = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invalid', password: 'short' }),
  })
  expect(signUp.status).toBe(400)
})

test('responses carry the secure headers', async () => {
  const { app } = createHealthTestApp({ databaseAvailable: true })

  const response = await app.request('/health/live')

  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  const expected = ['strict-transport-security', 'x-frame-options', 'referrer-policy']
  expect(expected.filter((header) => response.headers.has(header))).toEqual(expected)
})
