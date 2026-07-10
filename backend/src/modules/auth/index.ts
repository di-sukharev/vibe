import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AuthService } from './application/auth-service'
import type { Clock, LogoutCleanup, SubscriptionReader } from './application/ports'
import { createPrismaAuthRepository } from './infrastructure/auth-repository'
import { signAccessToken, verifyAccessToken } from './infrastructure/access-tokens'
import { hashPassword, verifyPassword } from './infrastructure/passwords'
import { createRefreshToken, hashRefreshToken } from './infrastructure/refresh-tokens'
import { verifySocialIdentity } from './infrastructure/social-providers'
import { createRequireAuth, type AuthHttpEnv } from './transport/middleware'
import { createAuthRoutes } from './transport/routes'
import { executeAuth } from './transport/errors'

type CreateAuthModuleOptions = {
  clock?: Clock
  db: DbClient
  env: AppEnv
  logoutCleanup?: LogoutCleanup
  subscriptionReader?: SubscriptionReader
}

const systemClock: Clock = {
  now: () => new Date(),
}

const noLogoutCleanup: LogoutCleanup = () => undefined
const inactiveSubscriptionReader: SubscriptionReader = () => ({
  entitlement: 'premium',
  isActive: false,
  state: 'inactive',
  platform: null,
  productId: null,
  originalTransactionId: null,
  transactionId: null,
  expiresAt: null,
  willAutoRenew: null,
  updatedAt: null,
})

export function createAuthModule({
  clock = systemClock,
  db,
  env,
  logoutCleanup = noLogoutCleanup,
  subscriptionReader = inactiveSubscriptionReader,
}: CreateAuthModuleOptions) {
  const service = new AuthService({
    accessTokens: {
      sign: (payload) => signAccessToken(payload, env),
      verify: (token) => verifyAccessToken(token, env),
    },
    clock,
    logoutCleanup,
    passwords: {
      hash: hashPassword,
      verify: verifyPassword,
    },
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    refreshTokens: {
      create: createRefreshToken,
      hash: hashRefreshToken,
    },
    repository: createPrismaAuthRepository(db),
    socialIdentities: {
      verify: (provider, idToken) => verifySocialIdentity(provider, idToken, env),
    },
    subscriptionReader,
  })
  const requireAuth = createRequireAuth((accessToken) => service.authenticateAccessToken(accessToken))

  return {
    authenticateAccessToken: (accessToken: string | undefined) =>
      executeAuth(() => service.authenticateAccessToken(accessToken)),
    requireAuth,
    routes: createAuthRoutes({ env, requireAuth, service }),
  }
}

export type { AuthHttpEnv }
export type { LogoutCleanup, SubscriptionReader } from './application/ports'
export type { AuthenticatedPrincipal } from './domain/user'
