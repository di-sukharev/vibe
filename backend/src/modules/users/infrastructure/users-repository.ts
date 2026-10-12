import type {
  AdminUserSummary,
  AdminUsersQuery,
  UserRole,
} from '@web-app-demo/contracts'
import { ADMIN_USERS_MAX_PAGE } from '@web-app-demo/contracts'

import {
  acquirePushTokenUserLock,
  acquireUserAuthenticationAuthorityLock,
  acquireUserRoleMutationLock,
  type DbClient,
  userAuthorityTransitionTransactionOptions,
} from '../../../db'
import type {
  AdminDashboardReader,
  AdminUsersReader,
  ProfileWriter,
  UserRoleUpdater,
} from '../application/ports'

const userSummarySelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  createdAt: true,
} as const

type UsersRepository =
  & ProfileWriter
  & AdminDashboardReader
  & AdminUsersReader
  & UserRoleUpdater

export function createPrismaUsersRepository(db: DbClient): UsersRepository {
  return {
    updateProfile(userId, displayName) {
      return db.user.update({
        where: { id: userId },
        data: { displayName },
        select: userSummarySelect,
      })
    },

    async dashboard(createdAfter) {
      const [totalUsers, totalAdmins, newUsersLast7Days] = await db.$transaction([
        db.user.count(),
        db.user.count({ where: { role: 'admin' } }),
        db.user.count({ where: { createdAt: { gte: createdAfter } } }),
      ])
      return { totalUsers, totalAdmins, newUsersLast7Days }
    },

    async listUsers({ page, pageSize, q }: AdminUsersQuery) {
      const where = q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { displayName: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}
      const [total, users] = await db.$transaction([
        db.user.count({ where }),
        db.user.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: userSummarySelect,
        }),
      ])
      return {
        items: users.map(toAdminUserSummary),
        page,
        pageSize,
        total,
        hasNext: page < ADMIN_USERS_MAX_PAGE && page * pageSize < total,
      }
    },

    withRoleMutation(targetUserId, run) {
      return db.$transaction(async (tx) => {
        await acquirePushTokenUserLock(tx, targetUserId)
        await acquireUserRoleMutationLock(tx)
        await acquireUserAuthenticationAuthorityLock(tx, targetUserId)
        return run({
          findUser: (id) => tx.user.findUnique({ where: { id }, select: userSummarySelect }),
          countAdmins: () => tx.user.count({ where: { role: 'admin' } }),
          async updateRoleAndRevoke(userId, role, now) {
            const updated = await tx.user.update({
              where: { id: userId }, data: { role }, select: userSummarySelect,
            })
            await tx.authSession.updateMany({
              where: { userId, revokedAt: null }, data: { revokedAt: now },
            })
            await tx.pushToken.deleteMany({ where: { userId } })
            await tx.passwordResetToken.updateMany({
              where: { userId, usedAt: null }, data: { usedAt: now },
            })
            return toAdminUserSummary(updated)
          },
        })
      }, userAuthorityTransitionTransactionOptions)
    },
  }
}

function toAdminUserSummary(user: {
  id: string
  email: string
  displayName: string | null
  role: UserRole
  createdAt: Date
}): AdminUserSummary {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
}
