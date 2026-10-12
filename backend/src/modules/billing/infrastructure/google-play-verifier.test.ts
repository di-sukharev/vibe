import { expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'

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
  signal?: AbortSignal
  url: string
}

test('Google Play verifier calls subscriptionsv2 get and subscription acknowledge endpoints', async () => {
  const calls: RequestInput[] = []
  const verifier = createGooglePlaySubscriptionVerifier(baseEnv, {
    requester: {
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
      signal: expect.any(AbortSignal),
      url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.app/purchases/subscriptionsv2/tokens/purchase%20token%2Fwith%2Fslash',
    },
    {
      data: {},
      method: 'POST',
      signal: expect.any(AbortSignal),
      url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.app/purchases/subscriptions/premium.subscription/tokens/purchase%20token%2Fwith%2Fslash:acknowledge',
    },
  ])
})

test('Google Play verifier maps invalid purchase and authorization API failures', async () => {
  await expect(
    createGooglePlaySubscriptionVerifier(baseEnv, {
      requester: {
        async request() {
          throw { response: { status: 404 } }
        },
      },
    }).getSubscriptionPurchase({ purchaseToken: 'missing-token' }),
  ).rejects.toMatchObject({
    code: 'IAP_INVALID_TRANSACTION',
  })

  await expect(
    createGooglePlaySubscriptionVerifier(baseEnv, {
      requester: {
        async request() {
          throw { response: { status: 403 } }
        },
      },
    }).acknowledgeSubscription({ productId: 'premium', purchaseToken: 'purchase-token' }),
  ).rejects.toMatchObject({
    code: 'IAP_NOT_CONFIGURED',
  })
})

test('Google Play verifier cancels a stalled OAuth refresh and can retry', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const env = {
    ...baseEnv,
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: JSON.stringify({
      client_email: 'iap@example.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  }
  let stall: 'oauth' | 'acknowledge' | null = 'oauth'
  let aborted = false
  let resourceRequests = 0
  const verifier = createGooglePlaySubscriptionVerifier(env, {
    requestTimeoutMs: 40,
    fetchImplementation: Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
      const oauth = String(url).includes('oauth2.googleapis.com/token')
      if ((oauth && stall === 'oauth') || (!oauth && stall === 'acknowledge')) {
        return new Promise<Response>((_resolve, reject) => {
          const fallback = setTimeout(() => reject(new Error('Provider stalled')), 300)
          init?.signal?.addEventListener('abort', () => {
            aborted = true
            clearTimeout(fallback)
            reject(init.signal?.reason)
          }, { once: true })
        })
      }
      if (oauth) {
        return Response.json({ access_token: 'external-test-token', expires_in: 3600 })
      }
      resourceRequests += 1
      return Response.json({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' })
    }, { preconnect() {} }),
  })

  await expect(verifier.getSubscriptionPurchase({ purchaseToken: 'test-purchase' }))
    .rejects.toMatchObject({ code: 'IAP_NOT_CONFIGURED' })
  expect(aborted).toBe(true)
  expect(resourceRequests).toBe(0)

  stall = null
  const purchase = await verifier.getSubscriptionPurchase({ purchaseToken: 'test-purchase' })
  expect(purchase.subscriptionState).toBe('SUBSCRIPTION_STATE_ACTIVE')
  expect(resourceRequests).toBe(1)

  stall = 'acknowledge'
  aborted = false
  await expect(verifier.acknowledgeSubscription({ productId: 'premium', purchaseToken: 'test-purchase' }))
    .rejects.toMatchObject({ code: 'IAP_NOT_CONFIGURED' })
  expect(aborted).toBe(true)
})
