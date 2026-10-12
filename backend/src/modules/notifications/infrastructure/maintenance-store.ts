import type { DbClient } from '../../../db'
import type { PushMaintenanceStore } from '../application/ports'

export function createPushMaintenanceStore(prisma: DbClient): PushMaintenanceStore {
  return {
    async cleanup(now, absoluteSessionNotBefore) {
  await prisma.$executeRaw`
    UPDATE "push_tokens" AS token
    SET "registration_session_id" = (
      SELECT session."id"
      FROM "auth_sessions" AS session
      WHERE session."user_id" = token."user_id"
        AND session."revoked_at" IS NULL
        AND session."expires_at" > ${now}
        AND session."created_at" > ${absoluteSessionNotBefore}
      ORDER BY session."created_at" DESC, session."id" DESC
      LIMIT 1
    )
    WHERE token."installation_id" IS NULL
      AND token."registration_session_id" IS NULL
  `
  await prisma.$executeRaw`
    DELETE FROM "push_tokens" AS token
    WHERE token."registration_session_id" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "auth_sessions" AS session
        WHERE session."id" = token."registration_session_id"
          AND session."user_id" = token."user_id"
          AND session."revoked_at" IS NULL
          AND session."expires_at" > ${now}
          AND session."created_at" > ${absoluteSessionNotBefore}
      )
  `
    },
  }
}
