import type {
  PasswordResetRequestResponse,
  RegisterPayload,
  SocialAuthProvider,
  SubscriptionSnapshot,
} from '@web-app-demo/contracts'

import type { TaskDeferrer } from '../../../background-tasks'
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

export type PasswordResetTaskDeferrer = TaskDeferrer

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

export type SubscriptionReader = (userId: string) =>
  | SubscriptionSnapshot
  | Promise<SubscriptionSnapshot>
export type LogoutCleanupStore = {
  removePushTokens(userId: string, expoPushTokens: string[]): Promise<void>
}

export type LogoutCleanup = (input: {
  expoPushTokens: string[]
  store: LogoutCleanupStore
  userId: string
}) => void | Promise<void>
