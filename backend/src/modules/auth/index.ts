import type { TaskDeferrer } from '../../background-tasks'
import type { DbClient } from '../../db'
import type { EmailDelivery } from '../../email/service'
import type { AppEnv } from '../../env'
import { AuthService } from './application/auth-service'
import type { Clock, LogoutCleanup } from './application/ports'
import { createPrismaAuthRepository } from './infrastructure/auth-repository'
import { signAccessToken, verifyAccessToken } from './infrastructure/access-tokens'
import { hashPassword, verifyPassword } from './infrastructure/passwords'
import { createPasswordResetNotifier } from './infrastructure/password-reset-notifier'
import {
  createPasswordResetToken,
  hashPasswordResetToken,
} from './infrastructure/password-reset-tokens'
import {
  createRefreshToken,
  deriveRotatedRefreshToken,
  hashRefreshToken,
  hashRefreshTokenFamily,
} from './infrastructure/refresh-tokens'
import { verifySocialIdentity } from './infrastructure/social-providers'
import { createRequireAuth, createRequireRole, type AuthHttpEnv } from './transport/middleware'
import { createAuthRoutes } from './transport/routes'
import { executeAuth } from './transport/errors'

type CreateAuthModuleOptions = {
  backgroundTasks: TaskDeferrer
  clock?: Clock
  db: DbClient
  emailDelivery: EmailDelivery
  env: AppEnv
  logoutCleanup?: LogoutCleanup
}

const systemClock: Clock = {
  now: () => new Date(),
}

const noLogoutCleanup: LogoutCleanup = () => undefined

export function createAuthModule({
  backgroundTasks,
  clock = systemClock,
  db,
  emailDelivery,
  env,
  logoutCleanup = noLogoutCleanup,
}: CreateAuthModuleOptions) {
  const service = new AuthService({
    accessTokens: {
      sign: (payload) => signAccessToken(payload, env),
      verify: (token) => verifyAccessToken(token, env),
    },
    backgroundTasks,
    clock,
    logoutCleanup,
    passwordResetCooldownSeconds: 60,
    passwordResetNotifier: createPasswordResetNotifier(
      emailDelivery,
      env.WEBAPP_ORIGIN ?? env.CORS_ORIGINS[0] ?? 'http://localhost:5173',
    ),
    passwordResetTokenTtlMinutes: 30,
    passwordResetTokens: {
      create: createPasswordResetToken,
      hash: hashPasswordResetToken,
    },
    passwords: {
      hash: hashPassword,
      verify: verifyPassword,
    },
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    refreshReuseGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    sessionAbsoluteTtlDays: env.SESSION_ABSOLUTE_TTL_DAYS,
    refreshTokens: {
      create: createRefreshToken,
      hash: hashRefreshToken,
      familyHash: (token) => hashRefreshTokenFamily(token, env.JWT_SECRET),
      rotate: (token) => deriveRotatedRefreshToken(token, env.JWT_SECRET),
    },
    repository: createPrismaAuthRepository(db),
    socialIdentities: {
      verify: (provider, idToken) => verifySocialIdentity(provider, idToken, env),
    },
  })
  const requireAuth = createRequireAuth((accessToken) => service.authenticateAccessToken(accessToken))

  return {
    authenticateAccessToken: (accessToken: string | undefined) =>
      executeAuth(() => service.authenticateAccessToken(accessToken)),
    requireAuth,
    requireAdmin: createRequireRole('admin'),
    routes: createAuthRoutes({ env, requireAuth, service }),
  }
}

export type { AuthHttpEnv }
export type { LogoutCleanup } from './application/ports'
export type { AuthenticatedPrincipal } from './domain/user'
