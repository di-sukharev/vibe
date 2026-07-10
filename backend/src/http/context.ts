import type { UserDto } from '@web-app-demo/contracts'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import type { AppStoreSubscriptionVerifier } from '../iap/apple-verifier'
import type { GooglePlaySubscriptionVerifier } from '../iap/google-play-verifier'
import type { AuthenticatedPrincipal } from '../modules/auth'
import type { StorageService } from '../storage/service'

export type AppHonoVariables = {
  appStoreIapVerifier: AppStoreSubscriptionVerifier
  authenticateAccessToken: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>
  env: AppEnv
  googlePlayIapVerifier: GooglePlaySubscriptionVerifier
  prisma: DbClient
  storageService: StorageService | null
}

export type AppHonoEnv = { Variables: AppHonoVariables }
export type AuthenticatedHonoEnv = {
  Variables: AppHonoVariables & { user: AuthenticatedPrincipal }
}

export function userDtoFromAuthenticatedUser(user: AuthenticatedPrincipal): UserDto {
  const { sessionId: _sessionId, ...dto } = user
  return dto
}
