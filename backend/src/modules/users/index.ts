import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { AuthHttpEnv } from '../auth'
import { UsersService } from './application/users-service'
import { createPrismaUsersRepository } from './infrastructure/users-repository'
import { createUsersRoutes } from './transport/routes'

type CreateUsersModuleOptions = {
  adminUsersReadRateLimit: MiddlewareHandler<AuthHttpEnv>
  db: DbClient
  requireAdmin: MiddlewareHandler<AuthHttpEnv>
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}

export function createUsersModule(options: CreateUsersModuleOptions) {
  const repository = createPrismaUsersRepository(options.db)
  const service = new UsersService({
    adminDashboardReader: repository,
    adminUsersReader: repository,
    clock: { now: () => new Date() },
    profileWriter: repository,
    userRoleUpdater: repository,
  })
  return createUsersRoutes({
    adminUsersReadRateLimit: options.adminUsersReadRateLimit,
    requireAdmin: options.requireAdmin,
    requireAuth: options.requireAuth,
    service,
  })
}
