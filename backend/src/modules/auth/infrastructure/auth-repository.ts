import { acquirePushTokenUserLock, type DbClient } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import type { AuthRepository } from '../application/ports'
import { AuthFailure } from '../domain/errors'

export function createPrismaAuthRepository(db: DbClient): AuthRepository {
  return {
    findUserByEmail(email) {
      return db.user.findUnique({ where: { email } })
    },

    async createPasswordUserWithSession(input) {
      try {
        return await db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: input.user.email,
              passwordHash: input.user.passwordHash,
              displayName: input.user.displayName,
            },
          })
          const session = await tx.authSession.create({
            data: {
              userId: user.id,
              refreshTokenHash: input.session.refreshTokenHash,
              refreshTokenFamilyHash: input.session.refreshTokenFamilyHash,
              expiresAt: input.session.expiresAt,
              userAgent: input.session.metadata.userAgent,
              ipAddress: input.session.metadata.ipAddress,
            },
            select: { id: true },
          })

          return { user, session }
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new AuthFailure('email_already_exists', 'User with this email already exists')
        }
        throw error
      }
    },

    findUserByProviderSubject(provider, subject) {
      return provider === 'apple'
        ? db.user.findUnique({ where: { appleSubject: subject } })
        : db.user.findUnique({ where: { googleSubject: subject } })
    },

    async createSocialUser(input) {
      try {
        return {
          created: true,
          user: await db.user.create({
            data: {
              displayName: input.displayName,
              email: input.email,
              passwordHash: null,
              ...(input.provider === 'apple'
                ? { appleSubject: input.subject }
                : { googleSubject: input.subject }),
            },
          }),
        }
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error

        const existing =
          input.provider === 'apple'
            ? await db.user.findUnique({ where: { appleSubject: input.subject } })
            : await db.user.findUnique({ where: { googleSubject: input.subject } })
        if (existing) return { created: false, user: existing }

        if (isProviderSubjectUniqueConstraint(error)) {
          throw new AuthFailure(
            'provider_account_already_linked',
            `${input.provider === 'apple' ? 'Apple' : 'Google'} account is already linked`,
          )
        }
        throw new AuthFailure(
          'social_email_already_exists',
          'An account with this email already exists',
        )
      }
    },

    createSession(input) {
      return db.authSession.create({
        data: {
          userId: input.userId,
          refreshTokenHash: input.refreshTokenHash,
          refreshTokenFamilyHash: input.refreshTokenFamilyHash,
          expiresAt: input.expiresAt,
          userAgent: input.metadata.userAgent,
          ipAddress: input.metadata.ipAddress,
        },
        select: { id: true },
      })
    },

    async findActiveRefreshSession(input) {
      const family = await db.authSession.findFirst({
        where: {
          refreshTokenFamilyHash: input.refreshTokenFamilyHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
      if (family) {
        if (family.refreshTokenHash === input.refreshTokenHash) {
          return { ...family, credentialState: 'current' as const }
        }

        const isPrevious = family.previousRefreshTokenHash === input.refreshTokenHash
        const withinGrace =
          isPrevious &&
          family.refreshRotatedAt !== null &&
          family.refreshRotatedAt >= input.reuseGraceAfter
        return {
          ...family,
          credentialState: withinGrace
            ? ('previous_within_grace' as const)
            : ('reused' as const),
        }
      }

      const current = await db.authSession.findFirst({
        where: {
          refreshTokenHash: input.refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
      if (current) {
        return { ...current, credentialState: 'current' as const }
      }

      const previous = await db.authSession.findFirst({
        where: {
          previousRefreshTokenHash: input.refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
      if (!previous) return null

      const withinGrace =
        previous.refreshRotatedAt !== null && previous.refreshRotatedAt >= input.reuseGraceAfter
      return {
        ...previous,
        credentialState: withinGrace
          ? ('previous_within_grace' as const)
          : ('reused' as const),
      }
    },

    rotateRefreshSession(input) {
      return db.authSession.updateMany({
        where: {
          id: input.currentSessionId,
          refreshTokenHash: input.currentRefreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
        },
        data: {
          previousRefreshTokenHash: input.currentRefreshTokenHash,
          refreshTokenHash: input.nextRefreshTokenHash,
          refreshTokenFamilyHash: input.nextRefreshTokenFamilyHash,
          refreshRotatedAt: input.now,
          expiresAt: input.nextExpiresAt,
          userAgent: input.metadata.userAgent,
          ipAddress: input.metadata.ipAddress,
        },
      }).then(({ count }) => count === 1)
    },

    revokeSessionById(input) {
      return db.$transaction(async (tx) => {
        const session = await tx.authSession.findUnique({
          where: { id: input.sessionId },
          select: { userId: true },
        })
        if (!session) return false

        await acquirePushTokenUserLock(tx, session.userId)
        const revoked = await tx.authSession.updateMany({
          where: { id: input.sessionId, revokedAt: null },
          data: { revokedAt: input.now },
        })
        await tx.pushToken.deleteMany({
          where: {
            registrationSessionId: input.sessionId,
            userId: session.userId,
          },
        })
        return revoked.count === 1
      })
    },

    findActiveAccessSession(input) {
      return db.authSession.findFirst({
        where: {
          id: input.sessionId,
          userId: input.userId,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
    },

    revokeSession(input, cleanup) {
      return db.$transaction(async (tx) => {
        const session = await tx.authSession.findFirst({
          where: {
            OR: [
              { refreshTokenHash: input.refreshTokenHash },
              { previousRefreshTokenHash: input.refreshTokenHash },
              { refreshTokenFamilyHash: input.refreshTokenFamilyHash },
            ],
            revokedAt: null,
            expiresAt: { gt: input.now },
          },
          select: { id: true, userId: true },
        })
        if (!session) return null

        await acquirePushTokenUserLock(tx, session.userId)
        await cleanup({
          expoPushTokens: input.expoPushTokens,
          store: {
            async removePushTokens(userId, expoPushTokens) {
              const ownership: Prisma.PushTokenWhereInput[] = [
                { registrationSessionId: session.id },
              ]
              if (expoPushTokens.length > 0) {
                ownership.push({ expoPushToken: { in: expoPushTokens } })
              }
              await tx.pushToken.deleteMany({
                where: { OR: ownership, userId },
              })
            },
          },
          userId: session.userId,
        })

        const revoked = await tx.authSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: input.now },
        })
        return revoked.count === 1 ? session.userId : null
      })
    },
  }
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function isProviderSubjectUniqueConstraint(error: Prisma.PrismaClientKnownRequestError) {
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
    ].includes(String(field)),
  )
}
