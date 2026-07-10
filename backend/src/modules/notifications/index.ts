import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { AuthenticatedPrincipal, LogoutCleanup } from '../auth'
import { NotificationService } from './application/notification-service'
import type { ExpoPushClientOptions } from './infrastructure/expo-client'
import { createNotificationAdapters } from './infrastructure/notification-operations'
import { createNotificationRoutes } from './transport/routes'

export function createNotificationsModule(input: {
  db: DbClient
  env: AppEnv
  pushClientOptions?: ExpoPushClientOptions
}) {
  const adapters = createNotificationAdapters({
    env: input.env,
    prisma: input.db,
    pushClientOptions: input.pushClientOptions,
  })
  const service = new NotificationService({
    ...adapters,
    createDedupeId: () => crypto.randomUUID(),
  })

  return {
    checkReceipts: service.checkReceipts.bind(service),
    cleanupTokens: service.cleanupTokens.bind(service),
    logoutCleanup: (async ({ expoPushTokens, store, userId }) => {
      await store.removePushTokens(userId, expoPushTokens)
    }) satisfies LogoutCleanup,
    createRoutes: (
      authenticateAccessToken: (
        accessToken: string | undefined,
      ) => Promise<AuthenticatedPrincipal>,
    ) => createNotificationRoutes({ authenticateAccessToken, service }),
    processOutbox: service.processOutbox.bind(service),
  }
}

export type {
  CheckPushReceiptsMetrics,
  EnqueuePushNotificationInput,
  ProcessPushOutboxMetrics,
} from './application/ports'
