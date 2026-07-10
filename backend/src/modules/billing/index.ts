import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { AuthenticatedPrincipal } from '../auth'
import { BillingService } from './application/billing-service'
import {
  createAppStoreSubscriptionVerifier,
  type AppStoreSubscriptionVerifier,
} from './infrastructure/apple-verifier'
import { createBillingOperations } from './infrastructure/billing-operations'
import {
  createGooglePlaySubscriptionVerifier,
  type GooglePlaySubscriptionVerifier,
} from './infrastructure/google-play-verifier'
import { createAppStoreWebhookRoutes, createIapRoutes } from './transport/routes'

export function createBillingModule(input: {
  appStoreVerifier?: AppStoreSubscriptionVerifier
  db: DbClient
  env: AppEnv
  googlePlayVerifier?: GooglePlaySubscriptionVerifier
}) {
  const appStoreVerifier =
    input.appStoreVerifier ?? createAppStoreSubscriptionVerifier(input.env)
  const googlePlayVerifier =
    input.googlePlayVerifier ?? createGooglePlaySubscriptionVerifier(input.env)
  const service = new BillingService(
    createBillingOperations({
      appStoreVerifier,
      db: input.db,
      env: input.env,
      googlePlayVerifier,
    }),
  )

  return {
    createRoutes: (
      authenticateAccessToken: (
        accessToken: string | undefined,
      ) => Promise<AuthenticatedPrincipal>,
    ) => createIapRoutes({ authenticateAccessToken, service }),
    getSubscription: (userId: string) => service.getSubscription(userId),
    webhookRoutes: createAppStoreWebhookRoutes(service),
  }
}

export type { AppStoreSubscriptionVerifier } from './infrastructure/apple-verifier'
export type { GooglePlaySubscriptionVerifier } from './infrastructure/google-play-verifier'
