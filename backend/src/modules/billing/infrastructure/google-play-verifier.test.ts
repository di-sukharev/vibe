import { expect, test } from 'bun:test'

import { loadEnv } from '../../../env'
import { createGooglePlaySubscriptionVerifier } from './google-play-verifier'

const baseEnv = loadEnv({
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  ACCESS_TOKEN_TTL_SECONDS: '60',
  APPLE_IAP_PRODUCT_IDS: 'premium_monthly',
  CORS_ORIGINS: 'http://localhost:5173',
  GOOGLE_PLAY_BASE_PLAN_IDS: 'monthly,yearly',
  GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
  GOOGLE_PLAY_PRODUCT_IDS: 'premium',
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(
    JSON.stringify({ client_email: 'iap@example.com' }),
  ).toString('base64'),
  JWT_SECRET: '12345678901234567890123456789012',
})

type RequestInput = {
  data?: unknown
  method: 'GET' | 'POST'
  timeout?: number
  url: string
}

test('Google Play verifier calls subscriptionsv2 get and subscription acknowledge endpoints', async () => {
  const calls: RequestInput[] = []
  const verifier = createGooglePlaySubscriptionVerifier(baseEnv, {
    async request<T>(input: RequestInput) {
      calls.push(input)
      return {
        data: (input.method === 'GET'
          ? {
              acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
              latestOrderId: 'GPA.1234-5678-9012-34567',
              subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            }
          : {}) as T,
      }
    },
  })

  const purchase = await verifier.getSubscriptionPurchase({ purchaseToken: 'purchase token/with/slash' })
  await verifier.acknowledgeSubscription({
    productId: 'premium.subscription',
    purchaseToken: 'purchase token/with/slash',
  })

  expect(purchase.subscriptionState).toBe('SUBSCRIPTION_STATE_ACTIVE')
  expect(calls).toEqual([
    {
      method: 'GET',
      timeout: 15_000,
      url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.app/purchases/subscriptionsv2/tokens/purchase%20token%2Fwith%2Fslash',
    },
    {
      data: {},
      method: 'POST',
      timeout: 15_000,
      url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.app/purchases/subscriptions/premium.subscription/tokens/purchase%20token%2Fwith%2Fslash:acknowledge',
    },
  ])
})

test('Google Play verifier maps invalid purchase and authorization API failures', async () => {
  await expect(
    createGooglePlaySubscriptionVerifier(baseEnv, {
      async request() {
        throw { response: { status: 404 } }
      },
    }).getSubscriptionPurchase({ purchaseToken: 'missing-token' }),
  ).rejects.toMatchObject({
    code: 'IAP_INVALID_TRANSACTION',
  })

  await expect(
    createGooglePlaySubscriptionVerifier(baseEnv, {
      async request() {
        throw { response: { status: 403 } }
      },
    }).acknowledgeSubscription({ productId: 'premium', purchaseToken: 'purchase-token' }),
  ).rejects.toMatchObject({
    code: 'IAP_NOT_CONFIGURED',
  })
})
