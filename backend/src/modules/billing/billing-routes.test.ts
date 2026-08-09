// While the billing tables are commented out in prisma/schema/billing.prisma, this module
// types the client through its own stand-ins; see infrastructure/prisma-billing-types.ts.
import { Environment, OfferType, Type, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { OpenAPIHono } from '@hono/zod-openapi'
import { SignJWT } from 'jose'
import { expect, mock, test } from 'bun:test'

import type { BillingDbClient } from './infrastructure/prisma-billing-types'
import { loadEnv, type AppEnv } from '../../env'
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

test('Google Play transaction route verifies purchases through the Google verifier', async () => {
  const acknowledgeSubscription = mock(async () => undefined)
  const entitlementUpsert = mock(async () => ({
    platform: 'android',
    state: SubscriptionState.active,
    productId: 'premium',
    originalTransactionId: null,
    transactionId: 'GPA.1234-5678-9012-34567',
    expiresAt: new Date('2099-07-01T00:00:00.000Z'),
    willAutoRenew: true,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  }))
  const googleUpsert = mock(async () => ({ id: 'google-row-1' }))
  const app = createTestIapApp(
    createFakeGoogleDb({ entitlementUpsert, googleUpsert }),
    {
      env: {
        ...env,
        GOOGLE_PLAY_PRODUCT_IDS: ['premium'],
        GOOGLE_PLAY_BASE_PLAN_IDS: ['monthly'],
      },
      googleVerifier: {
        acknowledgeSubscription,
        async getSubscriptionPurchase() {
          return {
            acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
            externalAccountIdentifiers: {
              obfuscatedExternalAccountId: userId,
            },
            latestOrderId: 'GPA.1234-5678-9012-34567',
            lineItems: [
              {
                autoRenewingPlan: { autoRenewEnabled: true },
                expiryTime: '2099-07-01T00:00:00.000Z',
                offerDetails: { basePlanId: 'monthly' },
                productId: 'premium',
              },
            ],
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          }
        },
      },
    },
  )

  const response = await postJson(app, '/api/iap/google-play/transactions', userId, {
    basePlanId: 'monthly',
    productId: 'premium',
    purchaseToken: 'purchase-token',
  })
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.subscription).toMatchObject({
    isActive: true,
    platform: 'android',
    transactionId: 'GPA.1234-5678-9012-34567',
  })
  expect(acknowledgeSubscription).toHaveBeenCalledWith({
    productId: 'premium',
    purchaseToken: 'purchase-token',
  })
  expect(googleUpsert).toHaveBeenCalled()
  expect(entitlementUpsert).toHaveBeenCalled()
})

function createTestIapApp(
  db: BillingDbClient,
  options: {
    env?: AppEnv
    googleVerifier?: GooglePlaySubscriptionVerifier
  } = {},
) {
  const app = new OpenAPIHono()
  const service = new BillingService(
    createBillingDependencies({
      appStoreVerifier: fakeOfferCodeVerifier(),
      db,
      env: options.env ?? env,
      googlePlayVerifier: options.googleVerifier ?? fakeGooglePlayVerifier(),
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

function createFakeGoogleDb({
  entitlementUpsert,
  googleUpsert,
}: {
  entitlementUpsert: ReturnType<typeof mock>
  googleUpsert: ReturnType<typeof mock>
}) {
  const db = {
    googlePlaySubscriptionPurchase: {
      findFirst: mock(async () => null),
      findMany: mock(async () => []),
      upsert: googleUpsert,
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
