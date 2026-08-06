import type {
  LoginRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RegisterPayload,
  SocialAuthPayload,
  SocialAuthProvider,
} from '@web-app-demo/contracts'

import { AuthFailure } from '../domain/errors'
import { sessionExpiresAt, type SessionMetadata } from '../domain/session'
import type { AuthUserRecord, AuthenticatedPrincipal } from '../domain/user'
import { toUserDto, userDtoFromPrincipal } from '../domain/user'
import type {
  AccessTokens,
  AuthRepository,
  Clock,
  LogoutCleanup,
  PasswordResetNotifier,
  PasswordResetTaskDeferrer,
  PasswordResetTokens,
  Passwords,
  RefreshTokens,
  SocialIdentities,
} from './ports'

type AuthServiceDependencies = {
  accessTokens: AccessTokens
  backgroundTasks: PasswordResetTaskDeferrer
  clock: Clock
  logoutCleanup: LogoutCleanup
  passwordResetCooldownSeconds: number
  passwordResetNotifier: PasswordResetNotifier
  passwordResetTokenTtlMinutes: number
  passwordResetTokens: PasswordResetTokens
  passwords: Passwords
  refreshTokenTtlDays: number
  refreshReuseGraceSeconds: number
  sessionAbsoluteTtlDays: number
  refreshTokens: RefreshTokens
  repository: AuthRepository
  socialIdentities?: SocialIdentities
}

export class AuthService {
  constructor(private readonly dependencies: AuthServiceDependencies) {}

  async register(input: RegisterPayload, metadata: SessionMetadata) {
    const existingUser = await this.dependencies.repository.findUserByEmail(input.email)
    if (existingUser) {
      throw new AuthFailure('email_already_exists', 'User with this email already exists')
    }

    const passwordHash = await this.dependencies.passwords.hash(input.password)
    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.refreshTokens.create()
    const { user, session } = await this.dependencies.repository.createPasswordUserWithSession({
      user: { ...input, passwordHash },
      session: {
        refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
        refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
        expiresAt: this.refreshExpiresAt(now),
        metadata,
      },
    })

    return this.sessionResponse(user, session.id, refreshToken)
  }

  async login(input: LoginRequest, metadata: SessionMetadata) {
    const user = await this.dependencies.repository.findUserByEmail(input.email)
    if (!user?.passwordHash) {
      throw new AuthFailure('invalid_credentials', 'Invalid email or password')
    }
    if (!(await this.dependencies.passwords.verify(input.password, user.passwordHash))) {
      throw new AuthFailure('invalid_credentials', 'Invalid email or password')
    }

    return this.issueSession(user, metadata, async (currentUser) =>
      Boolean(
        currentUser.passwordHash &&
        (
          currentUser.passwordHash === user.passwordHash ||
          await this.dependencies.passwords.verify(input.password, currentUser.passwordHash)
        )
      ),
    )
  }

  async socialAuth(
    provider: SocialAuthProvider,
    input: SocialAuthPayload,
    metadata: SessionMetadata,
  ) {
    if (!this.dependencies.socialIdentities) {
      throw new AuthFailure(
        'provider_not_configured',
        `${providerDisplayName(provider)} Sign-In is not configured`,
      )
    }

    const identity = await this.dependencies.socialIdentities.verify(provider, input.idToken)
    const existingBySubject = await this.dependencies.repository.findUserByProviderSubject(
      provider,
      identity.subject,
    )
    if (existingBySubject) {
      return { ...(await this.issueSession(existingBySubject, metadata)), created: false }
    }

    const email = identity.email?.trim().toLowerCase()
    if (!email) {
      throw new AuthFailure(
        'provider_email_required',
        `${providerDisplayName(provider)} did not provide an email address`,
      )
    }
    if (await this.dependencies.repository.findUserByEmail(email)) {
      throw new AuthFailure('social_email_already_exists', 'An account with this email already exists')
    }

    const result = await this.dependencies.repository.createSocialUser({
      displayName: input.displayName ?? identity.displayName,
      email,
      provider,
      subject: identity.subject,
    })
    return { ...(await this.issueSession(result.user, metadata)), created: result.created }
  }

  async requestPasswordReset(input: PasswordResetRequest) {
    const { backgroundTasks, passwordResetNotifier } = this.dependencies
    if (!passwordResetNotifier.configured) return { accepted: true as const }

    backgroundTasks.defer((signal) => this.deliverPasswordReset(input, signal))
    return { accepted: true as const }
  }

  private async deliverPasswordReset(input: PasswordResetRequest, signal: AbortSignal) {
    const { passwordResetNotifier, repository } = this.dependencies
    const user = await repository.findUserByEmail(input.email)
    if (!user?.passwordHash) return

    const now = this.dependencies.clock.now()
    const token = this.dependencies.passwordResetTokens.create()
    const tokenHash = this.dependencies.passwordResetTokens.hash(token)
    const expiresAt = new Date(
      now.getTime() + this.dependencies.passwordResetTokenTtlMinutes * 60 * 1000,
    )
    const created = await repository.createPasswordResetToken({
      userId: user.id,
      tokenHash,
      expiresAt,
      now,
      createdAfter: new Date(
        now.getTime() - this.dependencies.passwordResetCooldownSeconds * 1000,
      ),
    })
    if (!created) return

    try {
      await passwordResetNotifier.sendPasswordReset(
        {
          email: user.email,
          token,
          expiresAt,
        },
        signal,
      )
    } catch (error) {
      await repository.invalidatePasswordResetToken({ tokenHash, now })
      throw error
    }

  }

  async confirmPasswordReset(input: PasswordResetConfirmRequest) {
    const tokenHash = this.dependencies.passwordResetTokens.hash(input.token)
    const active = await this.dependencies.repository.hasActivePasswordResetToken({
      tokenHash,
      now: this.dependencies.clock.now(),
    })
    if (!active) {
      throw new AuthFailure(
        'password_reset_invalid',
        'Password reset link is invalid or expired',
      )
    }

    const passwordHash = await this.dependencies.passwords.hash(input.password)
    const completed = await this.dependencies.repository.completePasswordReset({
      tokenHash,
      passwordHash,
      now: this.dependencies.clock.now(),
    })
    if (!completed) {
      throw new AuthFailure(
        'password_reset_invalid',
        'Password reset link is invalid or expired',
      )
    }

    this.dependencies.backgroundTasks.defer((signal) =>
      this.dependencies.passwordResetNotifier.sendPasswordChanged(
        { email: completed.email },
        signal,
      ),
    )
  }

  async refresh(refreshToken: string | undefined, metadata: SessionMetadata) {
    if (!refreshToken) {
      throw new AuthFailure('refresh_token_required', 'Refresh token is required')
    }

    const now = this.dependencies.clock.now()
    const presentedRefreshTokenHash = this.dependencies.refreshTokens.hash(refreshToken)
    const refreshLookup = {
      refreshTokenHash: presentedRefreshTokenHash,
      refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
      now,
      createdAfter: this.sessionAbsoluteNotBefore(now),
      reuseGraceAfter: new Date(
        now.getTime() - this.dependencies.refreshReuseGraceSeconds * 1000,
      ),
    }
    let currentSession = await this.dependencies.repository.findActiveRefreshSession(refreshLookup)
    if (!currentSession) {
      throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
    }

    if (currentSession.credentialState === 'reused') {
      await this.dependencies.repository.revokeSessionById({
        sessionId: currentSession.id,
        now,
      })
      throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
    }

    const nextRefreshToken = this.dependencies.refreshTokens.rotate(refreshToken)
    const nextRefreshTokenHash = this.dependencies.refreshTokens.hash(nextRefreshToken)
    const nextRefreshTokenFamilyHash = this.dependencies.refreshTokens.familyHash(nextRefreshToken)
    if (currentSession.credentialState === 'previous_within_grace') {
      if (currentSession.refreshTokenHash !== nextRefreshTokenHash) {
        throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
      }
      return this.refreshResponse(currentSession, nextRefreshToken)
    }

    const rotated = await this.dependencies.repository.rotateRefreshSession({
      currentSessionId: currentSession.id,
      currentRefreshTokenHash: currentSession.refreshTokenHash,
      now,
      nextRefreshTokenHash,
      nextRefreshTokenFamilyHash,
      nextExpiresAt: this.refreshExpiresAt(now),
      metadata,
    })
    if (!rotated) {
      const racedSession = await this.dependencies.repository.findActiveRefreshSession(refreshLookup)
      if (!racedSession || racedSession.id !== currentSession.id) {
        throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
      }
      if (racedSession.credentialState === 'reused') {
        await this.dependencies.repository.revokeSessionById({
          sessionId: racedSession.id,
          now,
        })
        throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
      }
      if (
        racedSession.credentialState !== 'previous_within_grace' ||
        racedSession.refreshTokenHash !== nextRefreshTokenHash
      ) {
        throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
      }

      return this.refreshResponse(racedSession, nextRefreshToken)
    }

    return this.refreshResponse(currentSession, nextRefreshToken)
  }

  private async refreshResponse(
    session: { id: string; user: AuthUserRecord },
    refreshToken: string,
  ) {
    return {
      accessToken: await this.dependencies.accessTokens.sign({
        sub: session.user.id,
        email: session.user.email,
        sessionId: session.id,
      }),
      refreshToken,
    }
  }

  async authenticateAccessToken(accessToken: string | undefined): Promise<AuthenticatedPrincipal> {
    if (!accessToken) {
      throw new AuthFailure('access_token_required', 'Access token is required')
    }

    let payload
    try {
      payload = await this.dependencies.accessTokens.verify(accessToken)
    } catch {
      throw new AuthFailure('access_token_invalid', 'Access token is invalid or expired')
    }

    const now = this.dependencies.clock.now()
    const session = await this.dependencies.repository.findActiveAccessSession({
      sessionId: payload.sessionId,
      userId: payload.sub,
      now,
      createdAfter: this.sessionAbsoluteNotBefore(now),
    })
    if (!session) {
      throw new AuthFailure('session_invalid', 'Session is invalid or expired')
    }

    return {
      ...(await this.userDto(session.user)),
      sessionId: session.id,
    }
  }

  async getMe(accessToken: string | undefined) {
    return { user: userDtoFromPrincipal(await this.authenticateAccessToken(accessToken)) }
  }

  async logout(refreshToken: string | undefined, expoPushTokens: string[] = []) {
    if (!refreshToken) return false

    const userId = await this.dependencies.repository.revokeSession(
      {
        expoPushTokens,
        refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
        refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
        now: this.dependencies.clock.now(),
      },
      this.dependencies.logoutCleanup,
    )
    return Boolean(userId)
  }

  private async issueSession(
    user: AuthUserRecord,
    metadata: SessionMetadata,
    authorizeUser: (user: AuthUserRecord) => boolean | Promise<boolean> = () => true,
  ) {
    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.refreshTokens.create()
    const issued = await this.dependencies.repository.createSession({
      authorizeUser,
      userId: user.id,
      refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
      refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
      expiresAt: this.refreshExpiresAt(now),
      metadata,
    })
    if (!issued) {
      throw new AuthFailure('invalid_credentials', 'Invalid email or password')
    }

    return this.sessionResponse(issued.user, issued.session.id, refreshToken)
  }

  private async sessionResponse(user: AuthUserRecord, sessionId: string, refreshToken: string) {
    return {
      user: await this.userDto(user),
      accessToken: await this.dependencies.accessTokens.sign({
        sub: user.id,
        email: user.email,
        sessionId,
      }),
      refreshToken,
    }
  }

  private refreshExpiresAt(now: Date) {
    return sessionExpiresAt(now, this.dependencies.refreshTokenTtlDays)
  }

  private sessionAbsoluteNotBefore(now: Date) {
    return new Date(now.getTime() - this.dependencies.sessionAbsoluteTtlDays * 24 * 60 * 60 * 1000)
  }

  private userDto(user: AuthUserRecord) {
    return toUserDto(user)
  }
}

function providerDisplayName(provider: SocialAuthProvider) {
  return provider === 'apple' ? 'Apple' : 'Google'
}
