import type {
  LoginRequest,
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
  Passwords,
  RefreshTokens,
  SocialIdentities,
  SubscriptionReader,
} from './ports'

type AuthServiceDependencies = {
  accessTokens: AccessTokens
  clock: Clock
  logoutCleanup: LogoutCleanup
  passwords: Passwords
  refreshTokenTtlDays: number
  refreshTokens: RefreshTokens
  repository: AuthRepository
  socialIdentities?: SocialIdentities
  subscriptionReader: SubscriptionReader
}

export class AuthService {
  constructor(private readonly dependencies: AuthServiceDependencies) {}

  async register(input: RegisterPayload, metadata: SessionMetadata) {
    const existingUser = await this.dependencies.repository.findUserByEmail(input.email)
    if (existingUser) {
      throw new AuthFailure('email_already_exists', 'User with this email already exists')
    }

    const passwordHash = await this.dependencies.passwords.hash(input.password)
    const user = await this.dependencies.repository.createPasswordUser({ ...input, passwordHash })
    return this.issueSession(user, metadata)
  }

  async login(input: LoginRequest, metadata: SessionMetadata) {
    const user = await this.dependencies.repository.findUserByEmail(input.email)
    if (
      !user?.passwordHash ||
      !(await this.dependencies.passwords.verify(input.password, user.passwordHash))
    ) {
      throw new AuthFailure('invalid_credentials', 'Invalid email or password')
    }

    return this.issueSession(user, metadata)
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

  async refresh(refreshToken: string | undefined, metadata: SessionMetadata) {
    if (!refreshToken) {
      throw new AuthFailure('refresh_token_required', 'Refresh token is required')
    }

    const now = this.dependencies.clock.now()
    const currentSession = await this.dependencies.repository.findActiveRefreshSession({
      refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
      now,
    })
    if (!currentSession) {
      throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
    }

    const nextRefreshToken = this.dependencies.refreshTokens.create()
    const nextSession = await this.dependencies.repository.rotateRefreshSession({
      currentSessionId: currentSession.id,
      userId: currentSession.userId,
      now,
      nextRefreshTokenHash: this.dependencies.refreshTokens.hash(nextRefreshToken),
      nextExpiresAt: this.refreshExpiresAt(now),
      metadata,
    })
    if (!nextSession) {
      throw new AuthFailure('refresh_session_invalid', 'Refresh session is invalid or expired')
    }

    return {
      accessToken: await this.dependencies.accessTokens.sign({
        sub: currentSession.user.id,
        email: currentSession.user.email,
        sessionId: nextSession.id,
      }),
      refreshToken: nextRefreshToken,
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

    const session = await this.dependencies.repository.findActiveAccessSession({
      sessionId: payload.sessionId,
      userId: payload.sub,
      now: this.dependencies.clock.now(),
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

    const userId = await this.dependencies.repository.revokeSession({
      refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
      now: this.dependencies.clock.now(),
    })
    if (!userId) return false

    await this.dependencies.logoutCleanup({ expoPushTokens, userId })
    return true
  }

  private async issueSession(user: AuthUserRecord, metadata: SessionMetadata) {
    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.refreshTokens.create()
    const session = await this.dependencies.repository.createSession({
      userId: user.id,
      refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
      expiresAt: this.refreshExpiresAt(now),
      metadata,
    })

    return {
      user: await this.userDto(user),
      accessToken: await this.dependencies.accessTokens.sign({
        sub: user.id,
        email: user.email,
        sessionId: session.id,
      }),
      refreshToken,
    }
  }

  private refreshExpiresAt(now: Date) {
    return sessionExpiresAt(now, this.dependencies.refreshTokenTtlDays)
  }

  private async userDto(user: AuthUserRecord) {
    return toUserDto(user, await this.dependencies.subscriptionReader(user.id))
  }
}

function providerDisplayName(provider: SocialAuthProvider) {
  return provider === 'apple' ? 'Apple' : 'Google'
}
