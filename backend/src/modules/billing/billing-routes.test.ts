// @parked-test
//
// Subscriptions ship switched off: the tables are commented out in prisma/schema/billing.prisma,
// the routes are not mounted in src/app.ts, and this module is typed through hand-written
// stand-ins. Until docs/IAP.md is followed and billing is turned on, these suites assert a
// feature nobody runs, so they are parked rather than deleted - remove the marker above and they
// come back with the capability.

// While the billing tables are commented out in prisma/schema/billing.prisma, this module
// types the client through its own stand-ins; see infrastructure/prisma-billing-types.ts.
import { Environment, OfferType, Type, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { OpenAPIHono } from '@hono/zod-openapi'
import { SignJWT } from 'jose'
import { expect, mock, test } from 'bun:test'

import type { BillingDbClient } from './infrastructure/prisma-billing-types'
import { loadEnv } from '../../env'
import { SubscriptionState } from './infrastructure/prisma-billing-types'
import { handleError } from '../../http/errors'
import { BillingService } from './application/billing-service'
import { createBillingDependencies } from './infrastructure/billing-adapters'
import type { AppStoreSubscriptionVerifier } from './infrastructure/apple-verifier'
import type { GooglePlaySubscriptionVerifier } from './infrastructure/google-play-verifier'
import { createIapRoutes } from './transport/routes'

const userId = '018fd4f2-1f3a-7c88-bc49-333333333333'
const otherUserId = '018fd4f2-1f3a-7c88-bc49-444444444444'
const env = loadEnv({
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  ACCESS_TOKEN_TTL_SECONDS: '60',
  APPLE_IAP_PRODUCT_IDS: 'premium_monthly',
  CORS_ORIGINS: 'http://localhost:5173',
  JWT_SECRET: '12345678901234567890123456789012',
})

test('offer-code redemption route links tokenless App Store transactions only for the issuing user', async () => {
  const entitlementUpsert = mock(async () => entitlementRecord())
  const transactionUpsert = mock(async () => ({ id: 'transaction-row-1' }))
  const app = createTestIapApp(createFakeDb({ entitlementUpsert, transactionUpsert }))

  const tokenResponse = await postJson(app, '/api/iap/app-store/offer-code-redemption', userId)
  const tokenBody = await tokenResponse.json()
  expect(tokenResponse.status).toBe(200)
  expect(tokenBody.token).toBeString()

  const accepted = await postJson(app, '/api/iap/app-store/transactions', userId, {
    offerCodeRedemptionToken: tokenBody.token,
    signedTransactionInfo: 'signed-offer-code',
  })
  const acceptedBody = await accepted.json()

  expect(accepted.status).toBe(200)
  expect(acceptedBody.subscription).toMatchObject({
    isActive: true,
    transactionId: 'transaction-offer-code',
  })
  expect(transactionUpsert).toHaveBeenCalledTimes(1)
  expect(entitlementUpsert).toHaveBeenCalledTimes(1)

  const wrongUser = await postJson(app, '/api/iap/app-store/transactions', otherUserId, {
    offerCodeRedemptionToken: tokenBody.token,
    signedTransactionInfo: 'signed-offer-code',
  })
  const wrongUserBody = await wrongUser.json()

  expect(wrongUser.status).toBe(403)
  expect(wrongUserBody.error.code).toBe('IAP_OWNERSHIP_MISMATCH')
  expect(entitlementUpsert).toHaveBeenCalledTimes(1)
})

test('offer-code redemption route rejects expired redemption tokens before entitlement writes', async () => {
  const entitlementUpsert = mock(async () => entitlementRecord())
  const transactionUpsert = mock(async () => ({ id: 'transaction-row-1' }))
  const app = createTestIapApp(createFakeDb({ entitlementUpsert, transactionUpsert }))
  const expiredToken = await new SignJWT({ scope: 'iap_offer_code_redemption' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 60 * 60)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 30)
    .sign(new TextEncoder().encode(env.JWT_SECRET))

  const response = await postJson(app, '/api/iap/app-store/transactions', userId, {
    offerCodeRedemptionToken: expiredToken,
    signedTransactionInfo: 'signed-offer-code',
  })
  const body = await response.json()

  expect(response.status).toBe(403)
  expect(body.error.code).toBe('IAP_OWNERSHIP_MISMATCH')
  expect(transactionUpsert).not.toHaveBeenCalled()
  expect(entitlementUpsert).not.toHaveBeenCalled()
})

function createTestIapApp(db: BillingDbClient) {
  const app = new OpenAPIHono()
  const service = new BillingService(
    createBillingDependencies({
      appStoreVerifier: fakeOfferCodeVerifier(),
      db,
      env,
      googlePlayVerifier: fakeGooglePlayVerifier(),
    }),
  )
  app.route(
    '/api/iap',
    createIapRoutes({
      authenticateAccessToken: async (accessToken) => ({ id: accessToken }) as never,
      service,
    }),
  )
  app.onError(handleError)
  return app
}

function createFakeDb({
  entitlementUpsert,
  transactionUpsert,
}: {
  entitlementUpsert: ReturnType<typeof mock>
  transactionUpsert: ReturnType<typeof mock>
}) {
  const db = {
    appStoreTransaction: {
      findMany: mock(async () => []),
      upsert: transactionUpsert,
    },
    subscriptionEntitlement: {
      findUnique: mock(async () => null),
      upsert: entitlementUpsert,
    },
    $executeRaw: mock(async () => 1),
    $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  }
  return db as unknown as BillingDbClient
}

function fakeOfferCodeVerifier(): AppStoreSubscriptionVerifier {
  return {
    async verifyTransaction(): Promise<{ environment: Environment; payload: JWSTransactionDecodedPayload }> {
      return {
        environment: Environment.SANDBOX,
        payload: {
          environment: Environment.SANDBOX,
          expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
          offerIdentifier: 'WINBACK2026',
          offerType: OfferType.OFFER_CODE,
          originalTransactionId: 'original-offer-code',
          productId: 'premium_monthly',
          purchaseDate: Date.now(),
          transactionId: 'transaction-offer-code',
          type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
        },
      }
    },
    async verifyRenewalInfo(): Promise<{ environment: Environment; payload: JWSRenewalInfoDecodedPayload }> {
      throw new Error('unexpected renewal verification')
    },
    async verifyNotification(): Promise<{ environment: Environment; payload: ResponseBodyV2DecodedPayload }> {
      throw new Error('unexpected notification verification')
    },
    async getSubscriptionStatuses() {
      return []
    },
  }
}

function fakeGooglePlayVerifier(): GooglePlaySubscriptionVerifier {
  return {
    async getSubscriptionPurchase() {
      throw new Error('unexpected Google Play verification')
    },
    async acknowledgeSubscription() {
      throw new Error('unexpected Google Play acknowledge')
    },
  }
}

function entitlementRecord() {
  return {
    platform: 'ios',
    state: SubscriptionState.active,
    productId: 'premium_monthly',
    originalTransactionId: 'original-offer-code',
    transactionId: 'transaction-offer-code',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    willAutoRenew: null,
    updatedAt: new Date(),
  }
}

function postJson(app: ReturnType<typeof createTestIapApp>, path: string, userId: string, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userId}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
