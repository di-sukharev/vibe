import type { BillingDbClient } from './infrastructure/prisma-billing-types'
import type { AppEnv } from '../../env'
import type { AuthenticatedPrincipal } from '../auth'
import { BillingService } from './application/billing-service'
import {
  createAppStoreSubscriptionVerifier,
  type AppStoreSubscriptionVerifier,
} from './infrastructure/apple-verifier'
import { createBillingDependencies } from './infrastructure/billing-adapters'
import {
  createGooglePlaySubscriptionVerifier,
  type GooglePlaySubscriptionVerifier,
} from './infrastructure/google-play-verifier'
import { createAppStoreWebhookRoutes, createIapRoutes } from './transport/routes'

export function createBillingModule(input: {
  appStoreVerifier?: AppStoreSubscriptionVerifier
  db: BillingDbClient
  env: AppEnv
  googlePlayVerifier?: GooglePlaySubscriptionVerifier
}) {
  const appStoreVerifier =
    input.appStoreVerifier ?? createAppStoreSubscriptionVerifier(input.env)
  const googlePlayVerifier =
    input.googlePlayVerifier ?? createGooglePlaySubscriptionVerifier(input.env)
  const service = new BillingService(
    createBillingDependencies({
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
    reconcileGooglePlayBatch: (request: {
      before: Date
      deadline: Date
      limit: number
    }) => service.reconcileGooglePlayBatch(request),
    webhookRoutes: createAppStoreWebhookRoutes(service),
  }
}

export type { AppStoreSubscriptionVerifier } from './infrastructure/apple-verifier'
export type { GooglePlaySubscriptionVerifier } from './infrastructure/google-play-verifier'
