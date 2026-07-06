import type {
  LoginRequest,
  LogoutRequest,
  RegisterPayload,
  SocialAuthPayload,
  SocialAuthProvider,
  UserDto,
} from '@web-app-demo/contracts'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import type { AuthenticatedUserContext } from '../http/context'
import { userDtoFromAuthenticatedUser } from '../http/context'
import { AppError } from '../http/errors'
import { inactiveSubscriptionSnapshot, toSubscriptionSnapshot, type EntitlementRecord } from '../iap/service'
import { Prisma } from '../generated/prisma/client'
import { signAccessToken, verifyAccessToken } from './access-tokens'
import { hashPassword, verifyPassword } from './passwords'
import { createRefreshToken, hashRefreshToken } from './refresh-tokens'
import { verifySocialIdentity } from './social-providers'

type SessionMetadata = {
  userAgent?: string
  ipAddress?: string
}

type UserRecord = {
  id: string
  email: string
  displayName: string | null
  createdAt: Date
  subscriptionEntitlement?: EntitlementRecord | null
}

export class AuthService {
  constructor(
    private readonly db: DbClient,
    private readonly env: AppEnv,
  ) {}

  async register(input: RegisterPayload, metadata: SessionMetadata) {
    const existingUser = await this.db.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    })

    if (existingUser) {
      throw new AppError(409, 'CONFLICT', 'User with this email already exists')
    }

    const passwordHash = await hashPassword(input.password)

    const user = await this.db.user
      .create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error)) {
          throw new AppError(409, 'CONFLICT', 'User with this email already exists')
        }

        throw error
      })

    return this.issueSession(user, metadata)
  }

  async login(input: LoginRequest, metadata: SessionMetadata) {
    const user = await this.db.user.findUnique({
      where: { email: input.email },
      include: {
        subscriptionEntitlement: true,
      },
    })

    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid email or password')
    }

    if (!user.passwordHash) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid email or password')
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash)
    if (!passwordMatches) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid email or password')
    }

    return this.issueSession(user, metadata)
  }

  async socialAuth(
    provider: SocialAuthProvider,
    input: SocialAuthPayload,
    metadata: SessionMetadata,
  ) {
    const identity = await verifySocialIdentity(provider, input.idToken, this.env)
    const existingBySubject = await this.findUserByProviderSubject(provider, identity.subject)

    if (existingBySubject) {
      return {
        ...(await this.issueSession(existingBySubject, metadata)),
        created: false,
      }
    }

    const email = normalizeSocialEmail(identity.email)
    if (!email) {
      throw new AppError(
        401,
        'AUTH_PROVIDER_EMAIL_REQUIRED',
        `${providerDisplayName(provider)} did not provide an email address`,
      )
    }

    const existingByEmail = await this.db.user.findUnique({
      where: { email },
      select: { id: true },
    })

    if (existingByEmail) {
      throw new AppError(
        409,
        'AUTH_EMAIL_ALREADY_EXISTS',
        'An account with this email already exists',
      )
    }

    const displayName = input.displayName ?? identity.displayName
    let created = true
    const user = await this.db.user
      .create({
        data: {
          email,
          passwordHash: null,
          displayName,
          ...(provider === 'apple'
            ? { appleSubject: identity.subject }
            : { googleSubject: identity.subject }),
        },
      })
      .catch(async (error: unknown) => {
        if (!isUniqueConstraintError(error)) throw error

        const existingBySubjectAfterRace = await this.findUserByProviderSubject(provider, identity.subject)
        if (existingBySubjectAfterRace) {
          created = false
          return existingBySubjectAfterRace
        }

        if (isProviderSubjectUniqueConstraint(error)) {
          throw new AppError(
            409,
            'AUTH_PROVIDER_ACCOUNT_ALREADY_LINKED',
            `${providerDisplayName(provider)} account is already linked`,
          )
        }

        throw new AppError(
          409,
          'AUTH_EMAIL_ALREADY_EXISTS',
          'An account with this email already exists',
        )
      })

    return {
      ...(await this.issueSession(user, metadata)),
      created,
    }
  }

  async refresh(refreshToken: string | undefined, metadata: SessionMetadata) {
    if (!refreshToken) {
      throw new AppError(401, 'UNAUTHORIZED', 'Refresh token is required')
    }

    const refreshTokenHash = hashRefreshToken(refreshToken)
    const now = new Date()
    const currentSession = await this.db.authSession.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      include: {
        user: {
          include: {
            subscriptionEntitlement: true,
          },
        },
      },
    })

    if (!currentSession) {
      throw new AppError(401, 'UNAUTHORIZED', 'Refresh session is invalid or expired')
    }

    const nextRefreshToken = createRefreshToken()
    const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken)
    const expiresAt = this.refreshExpiresAt()

    const nextSession = await this.db.$transaction(async (tx) => {
      const revokeResult = await tx.authSession.updateMany({
        where: {
          id: currentSession.id,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: { revokedAt: now },
      })

      if (revokeResult.count !== 1) {
        throw new AppError(401, 'UNAUTHORIZED', 'Refresh session is invalid or expired')
      }

      return tx.authSession.create({
        data: {
          userId: currentSession.userId,
          refreshTokenHash: nextRefreshTokenHash,
          expiresAt,
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
        },
      })
    })

    const accessToken = await signAccessToken(
      {
        sub: currentSession.user.id,
        email: currentSession.user.email,
        sessionId: nextSession.id,
      },
      this.env,
    )

    return {
      accessToken,
      refreshToken: nextRefreshToken,
    }
  }

  async authenticateAccessToken(accessToken: string | undefined): Promise<AuthenticatedUserContext> {
    if (!accessToken) {
      throw new AppError(401, 'UNAUTHORIZED', 'Access token is required')
    }

    const payload = await verifyAccessToken(accessToken, this.env).catch(() => {
      throw new AppError(401, 'UNAUTHORIZED', 'Access token is invalid or expired')
    })

    const session = await this.db.authSession.findFirst({
      where: {
        id: payload.sessionId,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: {
          include: {
            subscriptionEntitlement: true,
          },
        },
      },
    })

    if (!session) {
      throw new AppError(401, 'UNAUTHORIZED', 'Session is invalid or expired')
    }

    return {
      ...toUserDto(session.user),
      sessionId: session.id,
    }
  }

  async getMe(accessToken: string | undefined) {
    const user = await this.authenticateAccessToken(accessToken)

    return {
      user: userDtoFromAuthenticatedUser(user),
    }
  }

  async logout(input: LogoutRequest = {}) {
    if (!input.refreshToken) return false

    const refreshTokenHash = hashRefreshToken(input.refreshToken)
    const now = new Date()
    return this.db.$transaction(async (tx) => {
      const session = await tx.authSession.findUnique({
        where: {
          refreshTokenHash,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        select: {
          userId: true,
        },
      })

      if (!session) return false

      const expoPushTokens = logoutExpoPushTokens(input)
      if (expoPushTokens.length > 0) {
        await tx.pushToken.deleteMany({
          where: {
            expoPushToken: {
              in: expoPushTokens,
            },
            userId: session.userId,
          },
        })
      }

      await tx.authSession.updateMany({
        where: {
          refreshTokenHash,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: {
          revokedAt: now,
        },
      })

      return true
    })
  }

  private async issueSession(user: UserRecord, metadata: SessionMetadata) {
    const refreshToken = createRefreshToken()
    const session = await this.db.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: this.refreshExpiresAt(),
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
      },
    })

    const accessToken = await signAccessToken(
      {
        sub: user.id,
        email: user.email,
        sessionId: session.id,
      },
      this.env,
    )

    return {
      user: toUserDto(user),
      accessToken,
      refreshToken,
    }
  }

  private refreshExpiresAt() {
    return new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  }

  private findUserByProviderSubject(provider: SocialAuthProvider, subject: string) {
    if (provider === 'apple') {
      return this.db.user.findUnique({
        where: { appleSubject: subject },
        include: {
          subscriptionEntitlement: true,
        },
      })
    }

    return this.db.user.findUnique({
      where: { googleSubject: subject },
      include: {
        subscriptionEntitlement: true,
      },
    })
  }
}

function logoutExpoPushTokens(input: LogoutRequest) {
  return [
    ...new Set(
      [input.expoPushToken, ...(input.expoPushTokens ?? [])].filter(
        (token): token is string => Boolean(token),
      ),
    ),
  ]
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function isProviderSubjectUniqueConstraint(error: unknown) {
  if (!isUniqueConstraintError(error)) return false

  const target = error.meta?.target
  const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : []
  return fields.some((field) =>
    [
      'appleSubject',
      'googleSubject',
      'apple_subject',
      'google_subject',
      'users_apple_subject_key',
      'users_google_subject_key',
    ].includes(field),
  )
}

function providerDisplayName(provider: SocialAuthProvider) {
  return provider === 'apple' ? 'Apple' : 'Google'
}

function normalizeSocialEmail(email: string | undefined) {
  return email?.trim().toLowerCase() || undefined
}

export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
    subscription: user.subscriptionEntitlement
      ? toSubscriptionSnapshot(user.subscriptionEntitlement)
      : inactiveSubscriptionSnapshot(),
  }
}
