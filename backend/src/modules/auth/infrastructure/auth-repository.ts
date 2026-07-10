import type { DbClient } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import type { AuthRepository } from '../application/ports'
import { AuthFailure } from '../domain/errors'

export function createPrismaAuthRepository(db: DbClient): AuthRepository {
  return {
    findUserByEmail(email) {
      return db.user.findUnique({ where: { email } })
    },

    async createPasswordUser(input) {
      try {
        return await db.user.create({
          data: {
            email: input.email,
            passwordHash: input.passwordHash,
            displayName: input.displayName,
          },
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
          expiresAt: input.expiresAt,
          userAgent: input.metadata.userAgent,
          ipAddress: input.metadata.ipAddress,
        },
        select: { id: true },
      })
    },

    findActiveRefreshSession(input) {
      return db.authSession.findFirst({
        where: {
          refreshTokenHash: input.refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
        },
        include: { user: true },
      })
    },

    rotateRefreshSession(input) {
      return db.$transaction(async (tx) => {
        const revoked = await tx.authSession.updateMany({
          where: {
            id: input.currentSessionId,
            revokedAt: null,
            expiresAt: { gt: input.now },
          },
          data: { revokedAt: input.now },
        })
        if (revoked.count !== 1) return null

        return tx.authSession.create({
          data: {
            userId: input.userId,
            refreshTokenHash: input.nextRefreshTokenHash,
            expiresAt: input.nextExpiresAt,
            userAgent: input.metadata.userAgent,
            ipAddress: input.metadata.ipAddress,
          },
          select: { id: true },
        })
      })
    },

    findActiveAccessSession(input) {
      return db.authSession.findFirst({
        where: {
          id: input.sessionId,
          userId: input.userId,
          revokedAt: null,
          expiresAt: { gt: input.now },
        },
        include: { user: true },
      })
    },

    revokeSession(input, cleanup) {
      return db.$transaction(async (tx) => {
        const session = await tx.authSession.findFirst({
          where: {
            refreshTokenHash: input.refreshTokenHash,
            revokedAt: null,
            expiresAt: { gt: input.now },
          },
          select: { id: true, userId: true },
        })
        if (!session) return null

        await cleanup({
          expoPushTokens: input.expoPushTokens,
          store: {
            async removePushTokens(userId, expoPushTokens) {
              if (expoPushTokens.length === 0) return
              await tx.pushToken.deleteMany({
                where: { expoPushToken: { in: expoPushTokens }, userId },
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
