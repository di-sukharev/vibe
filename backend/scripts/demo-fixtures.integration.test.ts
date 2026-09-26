import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../src/app'
import { createPrisma } from '../src/db'
import type { EmailDelivery } from '../src/email'
import { loadEnv } from '../src/env'
import { drainTaskOutbox } from '../src/outbox'
import type { BackendRuntime } from '../src/runtime'
import { demoFixtureUsers, seedDemoFixtures } from './demo-fixtures'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; run bun run test:backend:integration')

describe('seeded demo fixtures', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: 'http://localhost:5173',
  })
  const prisma = createPrisma(databaseUrl)
  const emailDelivery: EmailDelivery = { driver: 'console', configured: true, send: async () => {} }
  const app = createApp({ emailDelivery, env, prisma })
  const fixtureAdmin = demoFixtureUsers.find((user) => user.role === 'admin')
  if (!fixtureAdmin) throw new Error('The demo fixtures need an admin for this test')

  beforeEach(async () => {
    await prisma.taskOutbox.deleteMany()
    await prisma.passwordResetToken.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('a fixture admin cannot sign in, even with the password an older seed gave it', async () => {
    // A row from an older seed run carries the shared password; a repeat seed must lock it.
    await prisma.user.create({
      data: {
        email: fixtureAdmin.email,
        passwordHash: await Bun.password.hash('not-a-real-password', { algorithm: 'argon2id' }),
        role: 'admin',
      },
    })
    await seedDemoFixtures(prisma)

    const login = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fixtureAdmin.email, password: 'not-a-real-password' }),
    })
    expect(login.status).toBe(401)
  })

  test('a repeat seed ends a session opened under an older seed', async () => {
    await prisma.user.create({
      data: {
        email: fixtureAdmin.email,
        passwordHash: await Bun.password.hash('not-a-real-password', { algorithm: 'argon2id' }),
        role: 'admin',
      },
    })
    const login = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fixtureAdmin.email, password: 'not-a-real-password' }),
    })
    expect(login.status).toBe(200)
    const { refreshToken } = await login.json()

    await seedDemoFixtures(prisma)

    const refresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    expect(refresh.status).toBe(401)
  })

  test('a fixture account cannot be claimed through password reset', async () => {
    await seedDemoFixtures(prisma)

    const request = await app.request('/api/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fixtureAdmin.email }),
    })
    expect(request.status).toBe(202)

    const drainRuntime = { emailDelivery, env, prisma } as unknown as BackendRuntime
    await drainTaskOutbox(drainRuntime, { now: new Date() })
    expect(await prisma.passwordResetToken.count()).toBe(0)
  })
})
