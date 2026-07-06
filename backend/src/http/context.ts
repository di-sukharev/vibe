import type { UserDto } from '@web-app-demo/contracts'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import type { AuthService } from '../auth/service'
import type { AppStoreSubscriptionVerifier } from '../iap/apple-verifier'
import type { GooglePlaySubscriptionVerifier } from '../iap/google-play-verifier'
import type { StorageService } from '../storage/service'

export type AuthenticatedUserContext = UserDto & {
  sessionId: string
}

export type AppHonoVariables = {
  appStoreIapVerifier: AppStoreSubscriptionVerifier
  authService: AuthService
  env: AppEnv
  googlePlayIapVerifier: GooglePlaySubscriptionVerifier
  prisma: DbClient
  storageService: StorageService | null
}

export type AppHonoEnv = {
  Variables: AppHonoVariables
}

export type AuthenticatedHonoEnv = {
  Variables: AppHonoVariables & {
    user: AuthenticatedUserContext
  }
}

export function userDtoFromAuthenticatedUser(user: AuthenticatedUserContext): UserDto {
  const { sessionId: _sessionId, ...dto } = user
  return dto
}
