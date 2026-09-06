import type { DbClient } from '../../db'
import type { EmailDelivery } from '../../email'
import type { AppEnv } from '../../env'
import { drainPassCapacity } from '../../outbox'
import type { BackendRuntime } from '../../runtime'
import { AuthService } from './application/auth-service'
import { passwordResetCooldownSeconds, type Clock, type LogoutCleanup, type ProjectUser } from './application/ports'
import { toBaseUserDto } from './domain/user'
import { createPrismaAuthRepository } from './infrastructure/auth-repository'
import { signAccessToken, verifyAccessToken } from './infrastructure/access-tokens'
import { hashPassword, verifyPassword } from './infrastructure/passwords'
import { createPasswordResetNotifier } from './infrastructure/password-reset-notifier'
import { createPasswordResetTaskQueue } from './infrastructure/password-reset-task-queue'
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
import { createRequireAuth, createRequireRole, type AuthHttpEnv } from './transport/middleware'
import { createAuthRoutes } from './transport/routes'

type CreateAuthModuleOptions = {
  clock?: Clock
  db: DbClient
  emailDelivery: EmailDelivery
  env: AppEnv
  logoutCleanup?: LogoutCleanup
  projectUser?: ProjectUser
}

const systemClock: Clock = {
  now: () => new Date(),
}

const noLogoutCleanup: LogoutCleanup = () => undefined

export function createAuthModule({
  clock = systemClock,
  db,
  emailDelivery,
  env,
  logoutCleanup = noLogoutCleanup,
  projectUser = toBaseUserDto,
}: CreateAuthModuleOptions) {
  const service = buildAuthService({ clock, db, emailDelivery, env, logoutCleanup, projectUser })
  const requireAuth = createRequireAuth((accessToken) => service.authenticateAccessToken(accessToken))

  return {
    authenticateAccessToken: (accessToken: string | undefined) =>
      service.authenticateAccessToken(accessToken),
    requireAuth,
    requireAdmin: createRequireRole('admin'),
    routes: createAuthRoutes({ env, requireAuth, service }),
  }
}

/**
 * The same service without the HTTP surface, for the outbox handlers.
 *
 * A drain runs under `cron.ts`: building routes and middleware there to send one email would be
 * paying for a web server nobody is talking to.
 */
export function createAuthTasks(runtime: BackendRuntime) {
  const service = buildAuthService({
    clock: systemClock,
    db: runtime.prisma,
    emailDelivery: runtime.emailDelivery,
    env: runtime.env,
    logoutCleanup: noLogoutCleanup,
    projectUser: toBaseUserDto,
  })

  return {
    deliverPasswordChanged: service.deliverPasswordChanged.bind(service),
    deliverPasswordReset: service.deliverPasswordReset.bind(service),
  }
}

function buildAuthService({
  clock,
  db,
  emailDelivery,
  env,
  logoutCleanup,
  projectUser,
}: Required<CreateAuthModuleOptions>) {
  return new AuthService({
    accessTokens: {
      sign: (payload) => signAccessToken(payload, env),
      verify: (token) => verifyAccessToken(token, env),
    },
    clock,
    logoutCleanup,
    passwordResetCooldownSeconds,
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
    projectUser,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    refreshReuseGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    sessionAbsoluteTtlDays: env.SESSION_ABSOLUTE_TTL_DAYS,
    refreshTokens: {
      create: () => createRefreshToken(env.JWT_SECRET),
      hash: hashRefreshToken,
      familyHash: (token) => hashRefreshTokenFamily(token, env.JWT_SECRET),
      rotate: (token) => deriveRotatedRefreshToken(token, env.JWT_SECRET),
    },
    passwordResetTasks: createPasswordResetTaskQueue(db, { pendingLimit: drainPassCapacity(env) }),
    repository: createPrismaAuthRepository(db),
  })
}

export type { AuthHttpEnv }
export type { LogoutCleanup, ProjectUser } from './application/ports'
export type { AuthenticatedPrincipal } from './domain/user'
