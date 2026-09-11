import type { AppEnv } from '../env'
import { createDatabaseRateLimitStore, type RateLimitPrisma } from './database-store'
import { createMemoryRateLimitStore } from './memory-store'
import type { RateLimitPolicy, RateLimitStoreFactory } from './port'

/**
 * The one place a store is chosen. `createApp` asks for one factory per policy and hands it to
 * the middleware, which builds the store with the budget it enforces; the switch between "this
 * process is the whole truth" and "PostgreSQL is" is a single env variable, and no route knows
 * which one it got. docs/DEPLOYMENT.md says which hosting needs which.
 */
export function createRateLimitStores(
  env: AppEnv,
  prisma: RateLimitPrisma,
): (policy: RateLimitPolicy) => RateLimitStoreFactory {
  if (env.RATE_LIMIT_STORE === 'database') {
    return (policy) => () => createDatabaseRateLimitStore(prisma, policy)
  }

  return () => (budget) => createMemoryRateLimitStore(budget)
}

export type {
  RateLimitConsumption,
  RateLimitPolicy,
  RateLimitStore,
  RateLimitStoreFactory,
} from './port'
