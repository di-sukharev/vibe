import { expect, test } from 'bun:test'

import type { AuthRepository, ProjectUser } from './ports'
import { AuthService } from './auth-service'

const user = {
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'password-hash',
  displayName: null,
  role: 'user' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const projectUser: ProjectUser = async (record) => ({
  id: record.id,
  email: record.email,
  displayName: record.displayName,
  role: record.role,
  createdAt: record.createdAt.toISOString(),
})

const unusedPasswordResetDependencies = {
  passwordResetCooldownSeconds: 60,
  passwordResetNotifier: {
    configured: false,
    isPermanentFailure: () => false,
    sendPasswordChanged: async () => undefined,
    sendPasswordReset: async () => undefined,
  },
  passwordResetTokenTtlMinutes: 30,
  passwordResetTasks: {
    enqueuePasswordReset: async () => undefined,
  },
  passwordResetTokens: {
    create: () => 'r'.repeat(43),
    hash: (token: string) => `hash:${token}`,
  },
  projectUser,
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
    projectUser: async (record) => ({
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      role: record.role,
      createdAt: record.createdAt.toISOString(),
    }),
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

test('rejects login when the password changed between the initial check and the session transaction', async () => {
  // The transaction reads a fresh row. If its hash no longer matches the one already verified
  // outside, the race must be treated as a password change, not as an unchanged password.
  const changedUser = { ...user, passwordHash: 'different-password-hash' }
  const repository = {
    findUserByEmail: async () => user,
    createSession: async (input: Parameters<AuthRepository['createSession']>[0]) => {
      const authorized = await input.authorizeUser(changedUser)
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
      // The original plaintext re-checked against the changed hash: a password changed mid-flight
      // does not match it, so this is what rejects the race.
      verify: async (_password, passwordHash) => passwordHash === user.passwordHash,
    },
    projectUser,
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
  }, {})).rejects.toThrow('Invalid email or password')
})

test('login against an email with no account still runs a password verification', async () => {
  // A response that skips verification whenever the email does not resolve lets an attacker learn
  // which addresses have accounts purely from how fast the request comes back - the same
  // enumeration `requestPasswordReset` is deliberately built to refuse.
  const verifyCalls: string[] = []
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {} as never,
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: {
      hash: async () => 'password-hash',
      verify: async (_password, passwordHash) => {
        verifyCalls.push(passwordHash)
        return false
      },
    },
    projectUser,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {} as never,
    repository: { findUserByEmail: async () => null } as unknown as AuthRepository,
  })

  await expect(service.login({
    email: 'nobody@example.com',
    password: 'password123',
  }, {})).rejects.toThrow('Invalid email or password')
  expect(verifyCalls).toHaveLength(1)
  // Not a real account's hash - just something argon2id-shaped so the run costs what a real
  // wrong-password check costs.
  expect(verifyCalls[0]).not.toBe(user.passwordHash)
})

test('refresh keeps the logical session id stable while rotating its credential', async () => {
  const signedSessionIds: string[] = []
  const refreshCutoffs: Date[] = []
  const repository = {
    ...unusedPasswordResetRepository,
    findUserByEmail: async () => null,
    createPasswordUserWithSession: async () => ({ user, session: { id: 'session-created' } }),
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
    projectUser: async (record) => ({
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      role: record.role,
      createdAt: record.createdAt.toISOString(),
    }),
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

  await service.refresh('current-refresh-token', {})

  expect(signedSessionIds).toEqual(['session-stable'])
  expect(refreshCutoffs).toEqual([new Date('2025-10-03T00:00:00.000Z')])
})

test('authenticateAccessToken resolves a valid token and rejects a broken or expired one', async () => {
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {
      sign: async () => 'access-token',
      verify: async (token) => {
        if (token === 'broken-token') throw new Error('jwt malformed')
        return { sub: user.id, email: user.email, sessionId: 'session-1' }
      },
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    projectUser,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {} as never,
    repository: {
      findActiveAccessSession: async () => ({ id: 'session-1', user }),
    } as unknown as AuthRepository,
  })

  await expect(service.authenticateAccessToken('valid-token')).resolves.toMatchObject({
    id: user.id,
    sessionId: 'session-1',
  })
  // A malformed or expired JWT must surface as the domain failure, not the raw jose error - the
  // catch around `accessTokens.verify` is what turns one into the other.
  await expect(service.authenticateAccessToken('broken-token')).rejects.toThrow(
    'Access token is invalid or expired',
  )
})

// Credential reuse after grace and the rotation race are decided by SQL, so they are tested in
// `auth.integration.test.ts` against real Postgres with genuinely concurrent requests. Scripting
// either one through a fake repository only asserts that the fake was called the scripted number
// of times.

test('password reset request stays generic and creates nothing while delivery is disabled', async () => {
  let repositoryCalls = 0
  const queued: unknown[] = []
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {} as never,
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    passwordResetTasks: {
        enqueuePasswordReset: async (input) => void queued.push(input),
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
  // Nothing to deliver means nothing written down: no token, and no queued task that would sit
  // in the outbox forever waiting for a provider that never arrives.
  expect(repositoryCalls).toBe(0)
  expect(queued).toEqual([])
})

test('a reset request queues exactly one task without looking the account up', async () => {
  // The response must not reveal whether the address exists, so the account lookup belongs to the
  // handler. What the request does is one insert, identical either way.
  const now = new Date('2026-01-01T00:00:00.000Z')
  let repositoryCalls = 0
  const queued: unknown[] = []
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {} as never,
    clock: { now: () => now },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    passwordResetNotifier: {
      configured: true,
      isPermanentFailure: () => false,
      sendPasswordChanged: async () => undefined,
      sendPasswordReset: async () => undefined,
    },
    passwordResetTasks: {
        enqueuePasswordReset: async (input) => void queued.push(input),
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

  await expect(service.requestPasswordReset({ email: 'nobody@example.com' })).resolves.toEqual({
    accepted: true,
  })
  expect(queued).toEqual([{ email: 'nobody@example.com', now }])
  expect(repositoryCalls).toBe(0)
})

function deliveryService({
  invalidated,
  permanent = false,
  stored,
}: {
  invalidated: string[]
  /** Whether the notifier reports its failure as one no retry can fix. */
  permanent?: boolean
  stored: unknown[]
}) {
  const rawToken = 'r'.repeat(43)

  return new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {} as never,
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    passwordResetNotifier: {
      configured: true,
      isPermanentFailure: () => permanent,
      sendPasswordChanged: async () => undefined,
      sendPasswordReset: async () => {
        throw new Error('provider unavailable')
      },
    },
    passwordResetTokens: { create: () => rawToken, hash: (token) => `hash:${token}` },
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
}

test('a transient delivery failure leaves the reset link alive for the next attempt', async () => {
  // The old behaviour killed the token on the first hiccup, so one flaky provider call cost the
  // user their link even though the outbox was about to try again.
  const invalidated: string[] = []
  const stored: unknown[] = []
  const now = new Date('2026-01-01T00:00:00.000Z')

  await expect(
    deliveryService({ invalidated, stored }).deliverPasswordReset(
      { email: user.email },
      { finalAttempt: false, now, signal: new AbortController().signal },
    ),
  ).rejects.toThrow('provider unavailable')

  expect(stored).toEqual([
    {
      userId: user.id,
      tokenHash: `hash:${'r'.repeat(43)}`,
      expiresAt: new Date('2026-01-01T00:30:00.000Z'),
      now,
      createdAfter: new Date('2025-12-31T23:59:00.000Z'),
    },
  ])
  expect(invalidated).toEqual([])
})

test('the last delivery attempt invalidates the token before reporting failure', async () => {
  const invalidated: string[] = []
  const stored: unknown[] = []

  await expect(
    deliveryService({ invalidated, stored }).deliverPasswordReset(
      { email: user.email },
      {
        finalAttempt: true,
        now: new Date('2026-01-01T00:00:00.000Z'),
        signal: new AbortController().signal,
      },
    ),
  ).rejects.toThrow('provider unavailable')

  // No more attempts are coming, so a token nobody can ever receive must not stay live.
  expect(invalidated).toEqual([`hash:${'r'.repeat(43)}`])
})

test('a permanent rejection invalidates the token on the first attempt, not the last', async () => {
  // The drain decides a task is terminal only after the handler returns, so `finalAttempt` is
  // still false here and always will be. Waiting for it would leave a live token behind for a
  // link the provider has already refused to deliver.
  const invalidated: string[] = []
  const stored: unknown[] = []

  await expect(
    deliveryService({ invalidated, permanent: true, stored }).deliverPasswordReset(
      { email: user.email },
      {
        finalAttempt: false,
        now: new Date('2026-01-01T00:00:00.000Z'),
        signal: new AbortController().signal,
      },
    ),
  ).rejects.toThrow('provider unavailable')

  expect(invalidated).toEqual([`hash:${'r'.repeat(43)}`])
})

test('a delivery the cooldown refused sends nothing', async () => {
  // Without this branch the service would email a link whose token was never persisted, while
  // the account's earlier token is still the live one - the user follows it and is told the
  // link is invalid.
  const sent: unknown[] = []
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {} as never,
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    passwordResetNotifier: {
      configured: true,
      isPermanentFailure: () => false,
      sendPasswordChanged: async () => undefined,
      sendPasswordReset: async (input) => void sent.push(input),
    },
    refreshTokens: {} as never,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    repository: {
      findUserByEmail: async () => user,
      // What createPasswordResetToken does inside the cooldown window.
      createPasswordResetToken: async () => false,
    } as unknown as AuthRepository,
    sessionAbsoluteTtlDays: 90,
  })

  await expect(
    service.deliverPasswordReset(
      { email: user.email },
      {
        finalAttempt: false,
        now: new Date('2026-01-01T00:00:00.000Z'),
        signal: new AbortController().signal,
      },
    ),
  ).resolves.toBe('skipped')
  expect(sent).toEqual([])
})

test('delivery to an address with no account is skipped rather than retried', async () => {
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {} as never,
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    passwordResetNotifier: {
      configured: true,
      isPermanentFailure: () => false,
      sendPasswordChanged: async () => undefined,
      sendPasswordReset: async () => undefined,
    },
    refreshTokens: {} as never,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    repository: { findUserByEmail: async () => null } as unknown as AuthRepository,
    sessionAbsoluteTtlDays: 90,
  })

  await expect(
    service.deliverPasswordReset(
      { email: 'nobody@example.com' },
      {
        finalAttempt: false,
        now: new Date('2026-01-01T00:00:00.000Z'),
        signal: new AbortController().signal,
      },
    ),
  ).resolves.toBe('skipped')
})

test('password reset confirmation rejects invalid tokens before hashing and queues the notice', async () => {
  const changed: unknown[] = []
  const completed: Array<{ tokenHash: string; passwordHash: string; now: Date }> = []
  let active = false
  let valid = false
  let passwordHashCalls = 0
  const now = new Date('2026-01-01T00:00:00.000Z')
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {} as never,
    clock: { now: () => now },
    logoutCleanup: async () => undefined,
    passwords: {
      hash: async (password) => {
        passwordHashCalls += 1
        return `password:${password}`
      },
      verify: async () => true,
    },
    passwordResetNotifier: {
      configured: true,
      isPermanentFailure: () => false,
      sendPasswordChanged: async () => undefined,
      sendPasswordReset: async () => undefined,
    },
    refreshTokens: {} as never,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    repository: {
      hasActivePasswordResetToken: async () => active,
      completePasswordReset: async (
        input: Parameters<AuthRepository['completePasswordReset']>[0],
      ) => {
        completed.push({ now: input.now, passwordHash: input.passwordHash, tokenHash: input.tokenHash })
        if (!valid) return null
        // Stands in for the transaction: the repository is what runs this, and only on success.
        await input.queueNotice(user.email, async (task) => void changed.push(task))
        return { email: user.email }
      },
    } as unknown as AuthRepository,
    sessionAbsoluteTtlDays: 90,
  })

  const input = { token: 'r'.repeat(43), password: 'new-password-123' }
  await expect(service.confirmPasswordReset(input)).rejects.toThrow('invalid or expired')
  expect(passwordHashCalls).toBe(0)
  expect(completed).toEqual([])
  expect(changed).toEqual([])

  active = true
  valid = true
  await expect(service.confirmPasswordReset(input)).resolves.toBeUndefined()
  expect(completed).toEqual([
    { tokenHash: `hash:${input.token}`, passwordHash: `password:${input.password}`, now },
  ])
  expect(passwordHashCalls).toBe(1)
  // Keyed on the consumed token, so replaying the confirmation cannot send a second notice.
  expect(changed).toEqual([
    { dedupeKey: `hash:${input.token}`, payload: { email: user.email }, type: 'auth:password-changed' },
  ])
})
