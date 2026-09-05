import type {
  LoginRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RegisterPayload,
} from '@web-app-demo/contracts'

import { AuthFailure } from '../domain/errors'
import { sessionExpiresAt, type SessionMetadata } from '../domain/session'
import type { AuthUserRecord, AuthenticatedPrincipal } from '../domain/user'
import { userDtoFromPrincipal } from '../domain/user'
import type {
  AccessTokens,
  AuthRepository,
  Clock,
  LogoutCleanup,
  PasswordResetNotifier,
  PasswordResetTaskQueue,
  PasswordResetTokens,
  Passwords,
  ProjectUser,
  RefreshTokens,
} from './ports'

type AuthServiceDependencies = {
  accessTokens: AccessTokens
  passwordResetTasks: PasswordResetTaskQueue
  clock: Clock
  logoutCleanup: LogoutCleanup
  passwordResetCooldownSeconds: number
  passwordResetNotifier: PasswordResetNotifier
  passwordResetTokenTtlMinutes: number
  passwordResetTokens: PasswordResetTokens
  passwords: Passwords
  projectUser: ProjectUser
  refreshTokenTtlDays: number
  refreshReuseGraceSeconds: number
  sessionAbsoluteTtlDays: number
  refreshTokens: RefreshTokens
  repository: AuthRepository
}

export class AuthService {
  constructor(private readonly dependencies: AuthServiceDependencies) {}

  /**
   * Password work for an address that has no account. Without it a login for an unknown address
   * answers after a single indexed SELECT while a registered one pays full argon2, and the
   * difference is measurable from outside - the response time then answers the question the 401
   * body refuses to answer. The hash is built once, lazily, and never leaves this object; matching
   * it changes nothing, because the caller throws either way.
   */
  private decoyPasswordHash?: Promise<string>

  private async spendAbsentUserPasswordWork(password: string) {
    this.decoyPasswordHash ??= this.dependencies.passwords.hash('absent-user')
    await this.dependencies.passwords.verify(password, await this.decoyPasswordHash)
  }

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
      await this.spendAbsentUserPasswordWork(input.password)
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

  async requestPasswordReset(input: PasswordResetRequest) {
    const { passwordResetNotifier, passwordResetTasks } = this.dependencies
    // With no provider wired there is nothing to deliver, so nothing is written down either -
    // neither a token nor a queued task.
    if (!passwordResetNotifier.configured) return { accepted: true as const }

    // Exactly one insert, whether or not the address belongs to an account. That is what keeps
    // the response time from answering a question the response body refuses to answer - and it
    // makes the 202 a promise the system can keep, because the row is committed before it.
    await passwordResetTasks.enqueuePasswordReset({
      email: input.email,
      now: this.dependencies.clock.now(),
    })

    return { accepted: true as const }
  }

  /** Sends the "your password changed" notice. Nothing to compensate for if it never arrives. */
  async deliverPasswordChanged(input: { email: string }, signal: AbortSignal) {
    await this.dependencies.passwordResetNotifier.sendPasswordChanged(input, signal)
  }

  /**
   * The account-dependent half, run by the outbox rather than inside the request.
   *
   * `finalAttempt` decides whether a failed send is worth compensating for: until then the token
   * is left alive for the next attempt, because one provider hiccup should not cost the user
   * their reset link.
   */
  async deliverPasswordReset(
    input: PasswordResetRequest,
    { finalAttempt, now, signal }: { finalAttempt: boolean; now: Date; signal: AbortSignal },
  ): Promise<'done' | 'skipped'> {
    const { passwordResetNotifier, repository } = this.dependencies
    const user = await repository.findUserByEmail(input.email)
    if (!user?.passwordHash) return 'skipped'

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
    // The cooldown already refused a second token for this account. A retry that lands here is
    // one the drain will not repeat, so there is nothing left to send.
    if (!created) return 'skipped'

    try {
      await passwordResetNotifier.sendPasswordReset({ email: user.email, token, expiresAt }, signal)
    } catch (error) {
      // Also on a permanent failure, not only on the last attempt: the drain marks such a task
      // terminal *after* this returns, so waiting for `finalAttempt` would mean the compensation
      // never runs and a live token is left for a link that was never delivered.
      // Not atomic with the failure it compensates for: if this write itself throws, it
      // replaces the error in flight, the drain reads that as retryable, and the next attempt is
      // swallowed by the cooldown and reported as `skipped` - leaving a live token nobody will
      // receive. It needs a database failure inside a one-statement window and the exposure is
      // bounded by the token's TTL, so it is accepted rather than wrapped in more machinery.
      if (finalAttempt || passwordResetNotifier.isPermanentFailure(error)) {
        await repository.invalidatePasswordResetToken({ tokenHash, now })
      }
      throw error
    }

    return 'done'
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
      // Keyed on the token that was just consumed, so the notice cannot be sent twice however
      // many times this runs.
      queueNotice: (email, enqueue) =>
        enqueue({ dedupeKey: tokenHash, payload: { email }, type: 'auth:password-changed' }),
    })
    if (!completed) {
      throw new AuthFailure(
        'password_reset_invalid',
        'Password reset link is invalid or expired',
      )
    }
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
      ...(await this.dependencies.projectUser(session.user)),
      sessionId: session.id,
    }
  }

  async getMe(accessToken: string | undefined) {
    return { user: userDtoFromPrincipal(await this.authenticateAccessToken(accessToken)) }
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return false

    const userId = await this.dependencies.repository.revokeSession({
      refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
      refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
      now: this.dependencies.clock.now(),
    })
    if (!userId) return false

    await this.dependencies.logoutCleanup({ userId })
    return true
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
      user: await this.dependencies.projectUser(user),
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
}
