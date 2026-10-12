import type { DbClient } from '../../../db'
import type { AuthMaintenanceStore } from '../application/ports'

export function createAuthMaintenanceStore(db: DbClient): AuthMaintenanceStore {
  return {
    async deleteSessions(expiredBefore, createdBefore) {
      const result = await db.authSession.deleteMany({ where: { OR: [
        { expiresAt: { lt: expiredBefore } },
        { revokedAt: { lt: expiredBefore } },
        { createdAt: { lt: createdBefore } },
      ] } })
      return result.count
    },
    async deleteResetTokens(before) {
      return (await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: before } } })).count
    },
  }
}
