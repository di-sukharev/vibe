import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import { createStorageObjectKey, type PrivateStorage } from '../../storage'
import type { AuthHttpEnv } from '../auth'
import { AvatarsService } from './application/avatars-service'
import { cleanupPendingUploads } from './application/maintenance'
import { createPrismaAvatarMaintenanceStore, createPrismaAvatarsRepository } from './infrastructure/avatars-repository'
import { createUploadsRoutes } from './transport/routes'

type CreateUploadsModuleOptions = {
  db: DbClient
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  storage: PrivateStorage
}

export function createUploadsModule(options: CreateUploadsModuleOptions) {
  const service = new AvatarsService({
    clock: { now: () => new Date() },
    objectKeys: {
      createAvatarKey: (now) => createStorageObjectKey({ namespace: 'avatars', now }),
    },
    repository: createPrismaAvatarsRepository(options.db),
    storage: options.storage,
  })

  return {
    routes: createUploadsRoutes({ requireAuth: options.requireAuth, service }),
    service,
  }
}

export { AvatarsService } from './application/avatars-service'
export type { AvatarRepository } from './application/ports'

export function cleanupUploads(input: { db: DbClient; storage: PrivateStorage }, now: Date) {
  return cleanupPendingUploads(createPrismaAvatarMaintenanceStore(input.db), input.storage, now,
    (key, error) => console.error(`Job uploads:pending:cleanup could not delete ${key}:`, error))
}
