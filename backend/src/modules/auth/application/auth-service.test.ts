import { expect, test } from 'bun:test'

import type { AuthRepository, PasswordResetNotifier, SocialIdentity } from './ports'
import { AuthService } from './auth-service'

const user = {
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'password-hash',
  displayName: null,
  role: 'user' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const now = new Date('2026-01-01T00:00:00.000Z')
const rawToken = 'r'.repeat(43)
const signal = new AbortController().signal

type Dependencies = ConstructorParameters<typeof AuthService>[0]

/**
 * A service whose collaborators succeed quietly; each test overrides the ones it observes. The
 * repository holds only the methods a test provides, so any other call fails the test.
 */
function createService({
  repository = {},
  ...overrides
}: Partial<Omit<Dependencies, 'repository'>> & { repository?: Partial<AuthRepository> } = {}) {
  return new AuthService({
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-1' }),
    },
    clock: { now: () => now },
    logoutCleanup: async () => undefined,
    passwordResetCooldownSeconds: 60,
    passwordResetNotifier: notifier(),
    passwordResetTasks: { enqueuePasswordReset: async () => undefined },
    passwordResetTokenTtlMinutes: 30,
    passwordResetTokens: { create: () => rawToken, hash: (token) => `hash:${token}` },
    passwords: { hash: async () => 'password-hash', verify: async () => true },
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    refreshTokens: {
      create: () => 'refresh-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: (token) => `next:${token}`,
    },
    sessionAbsoluteTtlDays: 90,
    ...overrides,
    repository: repository as AuthRepository,
  })
}

function notifier(overrides: Partial<PasswordResetNotifier> = {}): PasswordResetNotifier {
  return {
    configured: true,
    isPermanentFailure: () => false,
    sendPasswordChanged: async () => undefined,
    sendPasswordReset: async () => undefined,
    ...overrides,
  }
}

function deliver(service: AuthService, finalAttempt: boolean) {
  return service.deliverPasswordReset({ email: user.email }, { finalAttempt, now, signal })
}

test('verifies an unchanged password before opening the session transaction', async () => {
  let insideSessionTransaction = false
  const verificationContexts: boolean[] = []
  const service = createService({
    passwords: {
      hash: async () => 'password-hash',
      verify: async () => {
        verificationContexts.push(insideSessionTransaction)
        return true
      },
    },
    repository: {
      findUserByEmail: async () => user,
      createSession: async (input) => {
        insideSessionTransaction = true
        const authorized = await input.authorizeUser(user)
        insideSessionTransaction = false
        return authorized ? { user, session: { id: 'session-created' } } : null
      },
    },
  })

  await expect(service.login({
    email: user.email,
    password: 'password123',
  }, {})).resolves.toMatchObject({
    accessToken: 'access-token',
  })
  expect(verificationContexts).toEqual([false])
})

// Credential reuse after grace and the rotation race are decided by SQL, so they are tested in
// `auth.integration.test.ts` against real Postgres with genuinely concurrent requests. Scripting
// either one through a fake repository only asserts that the fake was called the scripted number
// of times.

test('a reset request queues exactly one task without looking the account up', async () => {
  // The response must not reveal whether the address exists, so the account lookup belongs to the
  // handler. What the request does is hand the queue one enqueue, identical either way; whether
  // a row is written is the queue's own, address-blind decision.
  let repositoryCalls = 0
  const queued: unknown[] = []
  const service = createService({
    passwordResetTasks: { enqueuePasswordReset: async (input) => void queued.push(input) },
    repository: {
      findUserByEmail: async () => {
        repositoryCalls += 1
        return user
      },
    },
  })

  await expect(service.requestPasswordReset({ email: 'nobody@example.com' })).resolves.toEqual({
    accepted: true,
  })
  expect(queued).toEqual([{ email: 'nobody@example.com', now }])
  expect(repositoryCalls).toBe(0)
})

/** A delivery whose provider call fails, recording the token it stored and any it invalidated. */
function failingDeliveryService({ permanent = false }: { permanent?: boolean } = {}) {
  const invalidated: string[] = []
  const stored: unknown[] = []
  const service = createService({
    passwordResetNotifier: notifier({
      isPermanentFailure: () => permanent,
      sendPasswordReset: async () => {
        throw new Error('provider unavailable')
      },
    }),
    repository: {
      findUserByEmail: async () => user,
      createPasswordResetToken: async (input) => {
        stored.push(input)
        return true
      },
      invalidatePasswordResetToken: async ({ tokenHash }) => {
        invalidated.push(tokenHash)
      },
    },
  })

  return { invalidated, service, stored }
}

test('a transient delivery failure leaves the reset link alive for the next attempt', async () => {
  // The old behaviour killed the token on the first hiccup, so one flaky provider call cost the
  // user their link even though the outbox was about to try again.
  const { invalidated, service, stored } = failingDeliveryService()

  await expect(deliver(service, false)).rejects.toThrow('provider unavailable')

  expect(stored).toEqual([
    {
      userId: user.id,
      tokenHash: `hash:${rawToken}`,
      expiresAt: new Date('2026-01-01T00:30:00.000Z'),
      now,
      createdAfter: new Date('2025-12-31T23:59:00.000Z'),
    },
  ])
  expect(invalidated).toEqual([])
})

test('the last delivery attempt invalidates the token before reporting failure', async () => {
  const { invalidated, service } = failingDeliveryService()

  await expect(deliver(service, true)).rejects.toThrow('provider unavailable')

  // No more attempts are coming, so a token nobody can ever receive must not stay live.
  expect(invalidated).toEqual([`hash:${rawToken}`])
})

test('a permanent rejection invalidates the token on the first attempt, not the last', async () => {
  // The drain decides a task is terminal only after the handler returns, so `finalAttempt` is
  // still false here and always will be. Waiting for it would leave a live token behind for a
  // link the provider has already refused to deliver.
  const { invalidated, service } = failingDeliveryService({ permanent: true })

  await expect(deliver(service, false)).rejects.toThrow('provider unavailable')

  expect(invalidated).toEqual([`hash:${rawToken}`])
})

test('a delivery the cooldown refused sends nothing', async () => {
  // Without this branch the service would email a link whose token was never persisted, while
  // the account's earlier token is still the live one - the user follows it and is told the
  // link is invalid.
  const sent: unknown[] = []
  const service = createService({
    passwordResetNotifier: notifier({ sendPasswordReset: async (input) => void sent.push(input) }),
    repository: {
      findUserByEmail: async () => user,
      // What createPasswordResetToken does inside the cooldown window.
      createPasswordResetToken: async () => false,
    },
  })

  await expect(deliver(service, false)).resolves.toBe('skipped')
  expect(sent).toEqual([])
})

test('password reset confirmation rejects invalid tokens before hashing and queues the notice', async () => {
  const changed: unknown[] = []
  const completed: Array<{ tokenHash: string; passwordHash: string; now: Date }> = []
  let active = false
  let valid = false
  let passwordHashCalls = 0
  const service = createService({
    passwords: {
      hash: async (password) => {
        passwordHashCalls += 1
        return `password:${password}`
      },
      verify: async () => true,
    },
    repository: {
      hasActivePasswordResetToken: async () => active,
      completePasswordReset: async (input) => {
        completed.push({ now: input.now, passwordHash: input.passwordHash, tokenHash: input.tokenHash })
        if (!valid) return null
        // Stands in for the transaction: the repository is what runs this, and only on success.
        await input.queueNotice(user.email, async (task) => void changed.push(task))
        return { email: user.email }
      },
    },
  })

  const input = { token: rawToken, password: 'new-password-123' }
  await expect(service.confirmPasswordReset(input)).rejects.toMatchObject({
    kind: 'password_reset_invalid',
  })
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

test('an unknown address costs the same password work as a registered one', async () => {
  const verifiedAgainst: string[] = []
  const service = createService({
    passwords: {
      hash: async () => 'decoy-password-hash',
      verify: async (_password, passwordHash) => {
        verifiedAgainst.push(passwordHash)
        return false
      },
    },
    repository: { findUserByEmail: async () => null },
  })

  await expect(
    service.login({ email: 'nobody@example.com', password: 'password123' }, {}),
  ).rejects.toMatchObject({ kind: 'invalid_credentials' })

  // Without this the response time answers the question the 401 body refuses to answer.
  expect(verifiedAgainst).toHaveLength(1)
  expect(verifiedAgainst[0]).not.toBe(user.passwordHash)
})

// Sign in with Apple / Google ships switched off: its route is not mounted, so its integration
// suites are parked (docs/SOCIAL_AUTH.md). These service cases keep the parked capability honest.
const socialPayload = { idToken: 'token', displayName: undefined }

/** A social sign-in whose provider vouches for `identity`; the repository is the test's own. */
function socialService(
  repository: Partial<AuthRepository>,
  identity: SocialIdentity = { subject: 'provider-subject', email: 'social@example.com' },
) {
  return createService({
    repository: { createSession: async () => ({ user, session: { id: 'session-1' } }), ...repository },
    socialIdentities: { verify: async () => identity },
  })
}

test('social auth signs a returning subject in without an email lookup', async () => {
  // The subject is the identity; the provider's email may have changed since the first sign-in.
  // The repository has no email lookup here, so reaching for one fails the test.
  const service = socialService({ findUserByProviderSubject: async () => user })

  await expect(service.socialAuth('google', socialPayload, {})).resolves.toMatchObject({
    created: false,
  })
})

test('social auth creates a social-only user when the subject is new', async () => {
  const created: unknown[] = []
  const service = socialService({
    findUserByProviderSubject: async () => null,
    findUserByEmail: async () => null,
    createSocialUser: async (input) => {
      created.push(input)
      return { created: true, user: { ...user, email: input.email, passwordHash: null } }
    },
  })

  await expect(service.socialAuth('apple', socialPayload, {})).resolves.toMatchObject({
    created: true,
  })
  expect(created).toEqual([
    { email: 'social@example.com', provider: 'apple', subject: 'provider-subject' },
  ])
})

test('social auth refuses to take over an existing password account by email', async () => {
  // No createSocialUser here: the refusal has to come before any account is written.
  const service = socialService({
    findUserByProviderSubject: async () => null,
    findUserByEmail: async () => user,
  })

  await expect(service.socialAuth('google', socialPayload, {})).rejects.toMatchObject({
    kind: 'social_email_already_exists',
  })
})

test('social auth rejects a provider token that carries no email for a new subject', async () => {
  const service = socialService(
    { findUserByProviderSubject: async () => null },
    { subject: 'apple-subject' },
  )

  await expect(service.socialAuth('apple', socialPayload, {})).rejects.toMatchObject({
    kind: 'provider_email_required',
  })
})
