import { expect, test } from 'bun:test'

import type { AppEnv } from '../../../env'
import { createGooglePlaySubscriptionVerifier } from './google-play-verifier'

const baseEnv: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  JWT_SECRET: '12345678901234567890123456789012',
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  REFRESH_REUSE_GRACE_SECONDS: 10,
  SESSION_ABSOLUTE_TTL_DAYS: 90,
  SESSION_RETENTION_DAYS: 7,
  AUTH_BODY_LIMIT_BYTES: 64 * 1024,
  AUTH_RATE_LIMIT_MAX: 60,
  AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
  SHUTDOWN_GRACE_SECONDS: 20,
  TRUST_PROXY: false,
  COOKIE_SECURE: false,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  APPLE_IAP_ENVIRONMENT: 'Sandbox',
  APPLE_IAP_PRODUCT_IDS: ['premium_monthly'],
  APPLE_AUTH_JWKS_TIMEOUT_MS: 5000,
  GOOGLE_AUTH_CLIENT_IDS: [],
  GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'iap@example.com' })).toString('base64'),
  GOOGLE_PLAY_PRODUCT_IDS: ['premium'],
  GOOGLE_PLAY_BASE_PLAN_IDS: ['monthly', 'yearly'],
}

type RequestInput = {
  data?: unknown
  method: 'GET' | 'POST'
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
      url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.app/purchases/subscriptionsv2/tokens/purchase%20token%2Fwith%2Fslash',
    },
    {
      data: {},
      method: 'POST',
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
