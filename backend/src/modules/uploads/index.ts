import type { MiddlewareHandler } from 'hono'

import type { TaskDeferrer } from '../../background-tasks'
import type { DbClient } from '../../db'
import { createStorageObjectKey, type PrivateStorage } from '../../storage'
import type { AuthHttpEnv } from '../auth'
import { AvatarsService } from './application/avatars-service'
import { createPrismaAvatarsRepository } from './infrastructure/avatars-repository'
import { createUploadsRoutes } from './transport/routes'

type CreateUploadsModuleOptions = {
  backgroundTasks: TaskDeferrer
  db: DbClient
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  storage: PrivateStorage
}

export function createUploadsModule(options: CreateUploadsModuleOptions) {
  const service = new AvatarsService({
    clock: { now: () => new Date() },
    // Superseded objects are removed after the response, so a storage hiccup cannot fail an
    // upload the database already committed. The trade is deliberate and worth knowing: the row
    // is deleted with the transaction, so if this delete fails the object is orphaned with
    // nothing left pointing at it. `uploads:pending:cleanup` does not cover this path - it only
    // sweeps uploads that were never finalized. Recovering these would need the key to outlive
    // the row.
    deferDelete: (objectKey) => {
      options.backgroundTasks.defer(() => options.storage.deleteObject(objectKey))
    },
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
