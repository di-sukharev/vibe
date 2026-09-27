// @parked-test
//
// Social sign-in ships switched off: the route is defined but not mounted in
// transport/routes.ts. Until docs/SOCIAL_AUTH.md is followed and the route is on, these suites
// assert a feature nobody runs, so they are parked rather than deleted - remove the marker above
// and they come back with the capability.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma, type DbClient } from '../../db'
import { loadEnv } from '../../env'
import { socialAuthProviderDeps } from './infrastructure/social-providers'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; run bun run test:backend:integration')

describe('social sign-in API integration', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: 'http://localhost:5173',
    ACCESS_TOKEN_TTL_SECONDS: '60',
  })
  const prisma = createPrisma(databaseUrl)
  const app = createApp({ env, prisma })
  const originalVerifyGoogleIdToken = socialAuthProviderDeps.verifyGoogleIdToken
  const originalVerifyAppleIdToken = socialAuthProviderDeps.verifyAppleIdToken

  beforeEach(async () => {
    socialAuthProviderDeps.verifyGoogleIdToken = originalVerifyGoogleIdToken
    socialAuthProviderDeps.verifyAppleIdToken = originalVerifyAppleIdToken
    await prisma.taskOutbox.deleteMany()
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

  test('revokes social session issuance that wins authentication authority before a role change', async () => {
    const admin = await registerUser('social-race-admin@example.com')
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    })
    const target = await prisma.user.create({
      data: {
        email: 'social-race-target@example.com',
        googleSubject: 'social-race-subject',
        passwordHash: null,
      },
    })
    const sessionCreateGate = gateNextSessionCreate()
    const socialApp = createApp({
      env: { ...env, GOOGLE_AUTH_CLIENT_IDS: ['google-client-id'] },
      prisma: sessionCreateGate.db,
    })
    socialAuthProviderDeps.verifyGoogleIdToken = async () => ({
      provider: 'google',
      subject: 'social-race-subject',
    })

    try {
      const socialLogin = socialApp.request('/api/auth/token/social/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'social-race-token' }),
      })
      await sessionCreateGate.reached

      let roleChangeSettled = false
      const roleChange = Promise.resolve(app.request(`/api/admin/users/${target.id}/role`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${admin.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'admin' }),
      })).finally(() => {
        roleChangeSettled = true
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      const roleChangeSettledBeforeSocialLogin = roleChangeSettled
      sessionCreateGate.release()

      const [socialResponse, roleResponse] = await Promise.all([socialLogin, roleChange])
      const socialBody = await socialResponse.json()
      expect(socialResponse.status).toBe(200)
      expect(roleResponse.status).toBe(200)
      expect(roleChangeSettledBeforeSocialLogin).toBe(false)
      expect(await app.request('/api/auth/me', {
        headers: { Authorization: `Bearer ${socialBody.accessToken}` },
      })).toHaveProperty('status', 401)
    } finally {
      sessionCreateGate.release()
    }
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

  async function registerUser(email: string) {
    const response = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    })
    const body = await response.json()
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
    return { accessToken: body.accessToken as string, userId: user.id }
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
})
