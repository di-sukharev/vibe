import { expect, test } from 'bun:test'

import type { AuthRepository } from './ports'
import { AuthService } from './auth-service'

const user = {
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'password-hash',
  displayName: null,
  role: 'user' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const unusedPasswordResetDependencies = {
  backgroundTasks: {
    defer: () => undefined,
  },
  passwordResetCooldownSeconds: 60,
  passwordResetNotifier: {
    configured: false,
    sendPasswordChanged: async () => undefined,
    sendPasswordReset: async () => undefined,
  },
  passwordResetTokenTtlMinutes: 30,
  passwordResetTokens: {
    create: () => 'r'.repeat(43),
    hash: (token: string) => `hash:${token}`,
  },
}

const unusedPasswordResetRepository = {
  createPasswordResetToken: async () => false,
  invalidatePasswordResetToken: async () => undefined,
  hasActivePasswordResetToken: async () => false,
  completePasswordReset: async () => null,
}

test('verifies an unchanged password before opening the session transaction', async () => {
  let insideSessionTransaction = false
  const verificationContexts: boolean[] = []
  const repository = {
    findUserByEmail: async () => user,
    createSession: async (input: Parameters<AuthRepository['createSession']>[0]) => {
      insideSessionTransaction = true
      const authorized = await input.authorizeUser(user)
      insideSessionTransaction = false
      return authorized ? { user, session: { id: 'session-created' } } : null
    },
  } as unknown as AuthRepository
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-created' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: {
      hash: async () => 'password-hash',
      verify: async () => {
        verificationContexts.push(insideSessionTransaction)
        return true
      },
    },
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'refresh-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: (token) => `next:${token}`,
    },
    repository,
  })

  await expect(service.login({
    email: user.email,
    password: 'password123',
  }, {})).resolves.toMatchObject({
    accessToken: 'access-token',
  })
  expect(verificationContexts).toEqual([false])
})

test('refresh keeps the logical session id stable while rotating its credential', async () => {
  const signedSessionIds: string[] = []
  const refreshCutoffs: Date[] = []
  const repository = {
    ...unusedPasswordResetRepository,
    findUserByEmail: async () => null,
    findUserByProviderSubject: async () => null,
    createPasswordUserWithSession: async () => ({ user, session: { id: 'session-created' } }),
    createSocialUser: async () => ({ created: true, user }),
    createSession: async () => ({ user, session: { id: 'session-created' } }),
    findActiveRefreshSession: async (input) => {
      refreshCutoffs.push(input.createdAfter)
      return {
        id: 'session-stable',
        userId: user.id,
        user,
        refreshTokenHash: 'hash:current-refresh-token',
        credentialState: 'current',
      }
    },
    rotateRefreshSession: async () => true,
    findActiveAccessSession: async () => null,
    revokeSessionById: async () => false,
    revokeSession: async () => null,
  } satisfies AuthRepository

  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {
      sign: async (payload) => {
        signedSessionIds.push(payload.sessionId)
        return 'access-token'
      },
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-stable' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: {
      hash: async () => 'password-hash',
      verify: async () => true,
    },
    refreshTokenTtlDays: 30,
    refreshReuseGraceSeconds: 10,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'next-refresh-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: () => 'next-refresh-token',
    },
    repository,
  })

  const refreshed = await service.refresh('current-refresh-token', {})

  expect(signedSessionIds).toEqual(['session-stable'])
  expect(refreshCutoffs).toEqual([new Date('2025-10-03T00:00:00.000Z')])
})

test('refresh revokes the logical session when a previous credential is reused after grace', async () => {
  const revokedSessionIds: string[] = []
  const repository = {
    findActiveRefreshSession: async () => ({
      id: 'session-compromised',
      userId: user.id,
      user,
      refreshTokenHash: 'hash:attacker-current-token',
      credentialState: 'reused',
    }),
    revokeSessionById: async ({ sessionId }: { sessionId: string }) => {
      revokedSessionIds.push(sessionId)
      return true
    },
  } as unknown as AuthRepository
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-compromised' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'next-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: () => 'next-token',
    },
    repository,
  })

  await expect(service.refresh('owner-previous-token', {})).rejects.toThrow('invalid or expired')
  expect(revokedSessionIds).toEqual(['session-compromised'])
})

test('refresh returns the winning successor when another request wins the rotation race', async () => {
  let findCalls = 0
  let rotateCalls = 0
  const repository = {
    findActiveRefreshSession: async () => {
      findCalls += 1
      return {
        id: 'session-stable',
        userId: user.id,
        user,
        refreshTokenHash: findCalls === 1
          ? 'hash:shared-token'
          : 'hash:successor:shared-token',
        credentialState: findCalls === 1 ? 'current' : 'previous_within_grace',
      }
    },
    rotateRefreshSession: async () => {
      rotateCalls += 1
      return false
    },
  } as unknown as AuthRepository
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-stable' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'initial-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: (token) => `successor:${token}`,
    },
    repository,
  })

  await expect(service.refresh('shared-token', {})).resolves.toMatchObject({
    accessToken: 'access-token',
    refreshToken: 'successor:shared-token',
  })
  expect(findCalls).toBe(2)
  expect(rotateCalls).toBe(1)
})

test('password reset request stays generic and creates nothing while delivery is disabled', async () => {
  let repositoryCalls = 0
  const service = new AuthService({
    accessTokens: {} as never,
    backgroundTasks: { defer: () => undefined },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    passwordResetCooldownSeconds: 60,
    passwordResetNotifier: {
      configured: false,
      sendPasswordChanged: async () => undefined,
      sendPasswordReset: async () => undefined,
    },
    passwordResetTokenTtlMinutes: 30,
    passwordResetTokens: {
      create: () => 'r'.repeat(43),
      hash: (token) => `hash:${token}`,
    },
    refreshTokens: {} as never,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    repository: {
      findUserByEmail: async () => {
        repositoryCalls += 1
        return user
      },
    } as unknown as AuthRepository,
    sessionAbsoluteTtlDays: 90,
  })

  await expect(service.requestPasswordReset({ email: user.email })).resolves.toEqual({
    accepted: true,
  })
  expect(repositoryCalls).toBe(0)
})

test('password reset request reports delivery failure after invalidating its token', async () => {
  const deferredTasks: Array<(signal: AbortSignal) => Promise<void>> = []
  const invalidated: string[] = []
  const stored: Array<{
    userId: string
    tokenHash: string
    expiresAt: Date
    now: Date
    createdAfter: Date
  }> = []
  const rawToken = 'r'.repeat(43)
  const now = new Date('2026-01-01T00:00:00.000Z')
  const service = new AuthService({
    accessTokens: {} as never,
    backgroundTasks: {
      defer: (task) => deferredTasks.push(task),
    },
    clock: { now: () => now },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    passwordResetCooldownSeconds: 60,
    passwordResetNotifier: {
      configured: true,
      sendPasswordChanged: async () => undefined,
      sendPasswordReset: async () => {
        throw new Error('provider unavailable')
      },
    },
    passwordResetTokenTtlMinutes: 30,
    passwordResetTokens: {
      create: () => rawToken,
      hash: (token) => `hash:${token}`,
    },
    refreshTokens: {} as never,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    repository: {
      findUserByEmail: async () => user,
      createPasswordResetToken: async (
        input: Parameters<AuthRepository['createPasswordResetToken']>[0],
      ) => {
        stored.push(input)
        return true
      },
      invalidatePasswordResetToken: async ({ tokenHash }: { tokenHash: string }) => {
        invalidated.push(tokenHash)
      },
    } as unknown as AuthRepository,
    sessionAbsoluteTtlDays: 90,
  })

  await expect(service.requestPasswordReset({ email: user.email })).resolves.toEqual({
    accepted: true,
  })
  expect(stored).toEqual([])
  expect(deferredTasks).toHaveLength(1)

  await expect(
    deferredTasks[0]!(new AbortController().signal),
  ).rejects.toThrow('provider unavailable')
  expect(stored).toEqual([{
    userId: user.id,
    tokenHash: `hash:${rawToken}`,
    expiresAt: new Date('2026-01-01T00:30:00.000Z'),
    now,
    createdAfter: new Date('2025-12-31T23:59:00.000Z'),
  }])
  expect(invalidated).toEqual([`hash:${rawToken}`])
})

test('password reset confirmation rejects invalid tokens before hashing and defers notification', async () => {
  const deferredTasks: Array<(signal: AbortSignal) => Promise<void>> = []
  const changedEmails: string[] = []
  const completed: Array<{ tokenHash: string; passwordHash: string; now: Date }> = []
  let active = false
  let valid = false
  let passwordHashCalls = 0
  const now = new Date('2026-01-01T00:00:00.000Z')
  const service = new AuthService({
    accessTokens: {} as never,
    backgroundTasks: {
      defer: (task) => deferredTasks.push(task),
    },
    clock: { now: () => now },
    logoutCleanup: async () => undefined,
    passwords: {
      hash: async (password) => {
        passwordHashCalls += 1
        return `password:${password}`
      },
      verify: async () => true,
    },
    passwordResetCooldownSeconds: 60,
    passwordResetNotifier: {
      configured: true,
      sendPasswordChanged: async ({ email }) => {
        changedEmails.push(email)
      },
      sendPasswordReset: async () => undefined,
    },
    passwordResetTokenTtlMinutes: 30,
    passwordResetTokens: {
      create: () => 'r'.repeat(43),
      hash: (token) => `hash:${token}`,
    },
    refreshTokens: {} as never,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    repository: {
      hasActivePasswordResetToken: async () => active,
      completePasswordReset: async (
        input: Parameters<AuthRepository['completePasswordReset']>[0],
      ) => {
        completed.push(input)
        return valid ? { email: user.email } : null
      },
    } as unknown as AuthRepository,
    sessionAbsoluteTtlDays: 90,
  })

  const input = { token: 'r'.repeat(43), password: 'new-password-123' }
  await expect(service.confirmPasswordReset(input)).rejects.toThrow('invalid or expired')
  expect(passwordHashCalls).toBe(0)
  expect(completed).toEqual([])

  active = true
  valid = true
  await expect(service.confirmPasswordReset(input)).resolves.toBeUndefined()
  expect(completed).toEqual([
    { tokenHash: `hash:${input.token}`, passwordHash: `password:${input.password}`, now },
  ])
  expect(passwordHashCalls).toBe(1)
  expect(changedEmails).toEqual([])
  expect(deferredTasks).toHaveLength(1)

  await deferredTasks[0]!(new AbortController().signal)
  expect(changedEmails).toEqual([user.email])
})

// Sign in with Apple / Google ships switched off: the HTTP route is not mounted, so the
// integration suite that used to cover it is parked. These service-level cases keep the parked
// capability honest - they need no route and would catch a refactor breaking it silently.
function socialAuthService(overrides: {
  repository: Partial<AuthRepository>
  verify?: () => Promise<{ subject: string; email?: string; displayName?: string }>
}) {
  return new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-created' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: {
      hash: async () => 'password-hash',
      verify: async () => true,
    },
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'refresh-token',
      hash: (token: string) => `hash:${token}`,
      familyHash: (token: string) => `family:${token}`,
      rotate: (token: string) => `next:${token}`,
    },
    repository: overrides.repository as unknown as AuthRepository,
    socialIdentities: overrides.verify
      ? { verify: overrides.verify }
      : { verify: async () => ({ subject: 'provider-subject', email: 'social@example.com' }) },
  })
}

const socialMetadata = {}

test('social auth signs in a returning user by provider subject without touching email', async () => {
  let emailLookups = 0
  const service = socialAuthService({
    repository: {
      findUserByProviderSubject: async () => user,
      findUserByEmail: async () => {
        emailLookups += 1
        return null
      },
      createSession: async () => ({ user, session: { id: 'session-created' } }),
    },
  })

  const result = await service.socialAuth('google', { idToken: 'token', displayName: undefined }, socialMetadata)

  expect(result.created).toBe(false)
  expect(result.user.email).toBe(user.email)
  expect(emailLookups).toBe(0)
})

test('social auth creates a social-only user when the subject is new', async () => {
  let created: { email: string; provider: string; subject: string } | undefined
  const service = socialAuthService({
    repository: {
      findUserByProviderSubject: async () => null,
      findUserByEmail: async () => null,
      createSocialUser: async (input) => {
        created = { email: input.email, provider: input.provider, subject: input.subject }
        return { created: true, user: { ...user, email: input.email, passwordHash: null } }
      },
      createSession: async () => ({ user, session: { id: 'session-created' } }),
    },
  })

  const result = await service.socialAuth('apple', { idToken: 'token', displayName: undefined }, socialMetadata)

  expect(result.created).toBe(true)
  expect(created).toEqual({
    email: 'social@example.com',
    provider: 'apple',
    subject: 'provider-subject',
  })
})

test('social auth refuses to take over an existing password account by email', async () => {
  const service = socialAuthService({
    repository: {
      findUserByProviderSubject: async () => null,
      findUserByEmail: async () => user,
      createSocialUser: async () => {
        throw new Error('must not create a user for an existing email')
      },
    },
  })

  await expect(
    service.socialAuth('google', { idToken: 'token', displayName: undefined }, socialMetadata),
  ).rejects.toMatchObject({ kind: 'social_email_already_exists' })
})

test('social auth rejects a provider token that carries no email for a new subject', async () => {
  const service = socialAuthService({
    repository: {
      findUserByProviderSubject: async () => null,
      findUserByEmail: async () => null,
    },
    verify: async () => ({ subject: 'apple-subject' }),
  })

  await expect(
    service.socialAuth('apple', { idToken: 'token', displayName: undefined }, socialMetadata),
  ).rejects.toMatchObject({ kind: 'provider_email_required' })
})
