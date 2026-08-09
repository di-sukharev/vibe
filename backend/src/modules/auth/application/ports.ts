import type {
  PasswordResetRequestResponse,
  RegisterPayload,
  SocialAuthProvider,
} from '@web-app-demo/contracts'

import type { SessionMetadata } from '../domain/session'
import type { AuthUserRecord } from '../domain/user'

export type AccessTokenPayload = {
  sub: string
  sessionId: string
  email: string
}

export type AuthRepository = {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>
  createPasswordUserWithSession(input: {
    user: RegisterPayload & { passwordHash: string }
    session: {
      refreshTokenHash: string
      refreshTokenFamilyHash: string
      expiresAt: Date
      metadata: SessionMetadata
    }
  }): Promise<{ user: AuthUserRecord; session: { id: string } }>
  findUserByProviderSubject(
    provider: SocialAuthProvider,
    subject: string,
  ): Promise<AuthUserRecord | null>
  createSocialUser(input: {
    displayName?: string
    email: string
    provider: SocialAuthProvider
    subject: string
  }): Promise<{ created: boolean; user: AuthUserRecord }>
  createSession(input: {
    authorizeUser(user: AuthUserRecord): boolean | Promise<boolean>
    userId: string
    refreshTokenHash: string
    refreshTokenFamilyHash: string
    expiresAt: Date
    metadata: SessionMetadata
  }): Promise<{ user: AuthUserRecord; session: { id: string } } | null>
  findActiveRefreshSession(input: {
    refreshTokenHash: string
    refreshTokenFamilyHash: string
    now: Date
    createdAfter: Date
    reuseGraceAfter: Date
  }): Promise<{
    id: string
    userId: string
    user: AuthUserRecord
    refreshTokenHash: string
    credentialState: 'current' | 'previous_within_grace' | 'reused'
  } | null>
  rotateRefreshSession(input: {
    currentSessionId: string
    currentRefreshTokenHash: string
    now: Date
    nextRefreshTokenHash: string
    nextRefreshTokenFamilyHash: string
    nextExpiresAt: Date
    metadata: SessionMetadata
  }): Promise<boolean>
  revokeSessionById(input: { sessionId: string; now: Date }): Promise<boolean>
  findActiveAccessSession(input: {
    sessionId: string
    userId: string
    now: Date
    createdAfter: Date
  }): Promise<{ id: string; user: AuthUserRecord } | null>
  revokeSession(
    input: {
      expoPushTokens: string[]
      refreshTokenHash: string
      refreshTokenFamilyHash: string
      now: Date
    },
    cleanup: LogoutCleanup,
  ): Promise<string | null>
  createPasswordResetToken(input: {
    userId: string
    tokenHash: string
    expiresAt: Date
    now: Date
    createdAfter: Date
  }): Promise<boolean>
  invalidatePasswordResetToken(input: { tokenHash: string; now: Date }): Promise<void>
  hasActivePasswordResetToken(input: { tokenHash: string; now: Date }): Promise<boolean>
  completePasswordReset(input: {
    tokenHash: string
    passwordHash: string
    now: Date
    /**
     * Called inside the transaction that consumes the token, so a committed password change
     * cannot exist without its notice queued - and a failure to queue rolls the change back
     * instead of returning an error for work that already happened.
     */
    queueNotice(email: string, enqueue: (task: QueuedTask) => Promise<void>): Promise<void>
  }): Promise<{ email: string } | null>
}

export type AccessTokens = {
  sign(payload: AccessTokenPayload): Promise<string>
  verify(token: string): Promise<AccessTokenPayload>
}

export type Passwords = {
  hash(password: string): Promise<string>
  verify(password: string, passwordHash: string): Promise<boolean>
}

export type PasswordResetTokens = {
  create(): string
  hash(token: string): string
}

export type PasswordResetNotifier = {
  configured: boolean
  sendPasswordReset(
    input: { email: string; token: string; expiresAt: Date },
    signal: AbortSignal,
  ): Promise<void>
  sendPasswordChanged(input: { email: string }, signal: AbortSignal): Promise<void>
}

/**
 * Queues the account-dependent half of a password reset.
 *
 * The request handler must not look the account up: doing so would make the response time reveal
 * whether the address exists. It writes one row for any address, and the handler decides.
 */
export type PasswordResetTaskQueue = {
  enqueuePasswordReset(input: { email: string; now: Date }): Promise<void>
}

/**
 * How long an account must wait before a second reset token can be minted.
 *
 * Exported because two other things are pinned to it: the outbox retry delay has to clear it, or
 * a retry is silently swallowed as a cooldown hit and the user never gets a link; and the dedupe
 * bucket matches it, so a collapsed burst and a refused token mean the same thing.
 * `password-reset-cooldown.test.ts` pins the retry delay; `password-reset-task-queue.test.ts`
 * pins the bucket.
 */
export const passwordResetCooldownSeconds = 60

/** What the application asks for; the infrastructure decides which client writes it. */
export type QueuedTask = {
  type: string
  dedupeKey: string
  payload: unknown
}

export const passwordResetAccepted = {
  accepted: true,
} satisfies PasswordResetRequestResponse

export type RefreshTokens = {
  create(): string
  hash(token: string): string
  familyHash(token: string): string
  rotate(token: string): string
}

export type Clock = {
  now(): Date
}

export type SocialIdentity = {
  subject: string
  email?: string
  displayName?: string
}

export type SocialIdentities = {
  verify(provider: SocialAuthProvider, idToken: string): Promise<SocialIdentity>
}

export type LogoutCleanupStore = {
  removePushTokens(userId: string, expoPushTokens: string[]): Promise<void>
}

export type LogoutCleanup = (input: {
  expoPushTokens: string[]
  store: LogoutCleanupStore
  userId: string
}) => void | Promise<void>
