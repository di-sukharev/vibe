import { Environment, OfferType, Status, Type, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { expect, mock, test } from 'bun:test'

import type { DbClient } from '../../../db'
import type { AppEnv } from '../../../env'
import { SubscriptionState } from '../../../generated/prisma/enums'
import { BillingService } from '../application/billing-service'
import type { AppStoreSubscriptionVerifier } from './apple-verifier'
import { createBillingDependencies } from './billing-adapters'
import type { GooglePlaySubscriptionVerifier } from './google-play-verifier'

const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  JWT_SECRET: '12345678901234567890123456789012',
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: false,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  APPLE_IAP_ENVIRONMENT: 'Sandbox',
  APPLE_IAP_PRODUCT_IDS: ['premium_monthly'],
  APPLE_AUTH_JWKS_TIMEOUT_MS: 5000,
  GOOGLE_AUTH_CLIENT_IDS: [],
  GOOGLE_PLAY_PRODUCT_IDS: [],
  GOOGLE_PLAY_BASE_PLAN_IDS: [],
}
const googlePlayEnv: AppEnv = {
  ...env,
  GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'iap@example.com' })).toString('base64'),
  GOOGLE_PLAY_PRODUCT_IDS: ['premium'],
  GOOGLE_PLAY_BASE_PLAN_IDS: ['monthly', 'yearly'],
}

test('releases webhook claims when final processed marker write fails', async () => {
  const deleteMany = mock(async () => ({ count: 1 }))
  const db = {
    appStoreWebhook: {
      create: mock(async () => ({ id: 'webhook-1' })),
      update: mock(async (args: { data: { processedAt?: Date } }) => {
        if (args.data.processedAt) {
          throw new Error('final marker write failed')
        }
        return { id: 'webhook-1' }
      }),
      deleteMany,
    },
    appStoreTransaction: {
      upsert: mock(async () => ({ id: 'transaction-row-1' })),
    },
    subscriptionEntitlement: {
      findUnique: mock(async () => null),
      upsert: mock(async () => ({
        platform: 'ios',
        state: SubscriptionState.active,
        productId: 'premium_monthly',
        originalTransactionId: 'original-1',
        transactionId: 'transaction-1',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        willAutoRenew: null,
        updatedAt: new Date(),
      })),
    },
    user: {
      findUnique: mock(async () => ({ id: '018fd4f2-1f3a-7c88-bc49-333333333333' })),
    },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  } as unknown as DbClient

  await expect(
    billingService({ db, appStoreVerifier: fakeVerifier() }).processAppStoreWebhook(
      'signed-webhook',
    ),
  ).rejects.toThrow('final marker write failed')

  expect(deleteMany).toHaveBeenCalledWith({
    where: {
      id: 'webhook-1',
      processedAt: null,
    },
  })
})

test('uses the configured production App Store environment for original transaction reconcile', async () => {
  const getSubscriptionStatuses = mock(async () => [])
  const db = {
    subscriptionEntitlement: {
      findUnique: mock(async () => null),
    },
  } as unknown as DbClient

  await billingService({
    db,
    env: {
      ...env,
      APPLE_IAP_APP_APPLE_ID: 123456789,
      APPLE_IAP_ENVIRONMENT: 'Production',
    },
    appStoreVerifier: {
      ...fakeVerifier(),
      getSubscriptionStatuses,
    },
  }).reconcileAppStore({
    userId: '018fd4f2-1f3a-7c88-bc49-333333333333',
    originalTransactionIds: ['original-1'],
  })

  expect(getSubscriptionStatuses).toHaveBeenCalledWith({
    transactionId: 'original-1',
    environment: Environment.PRODUCTION,
  })
})

test('keeps billing grace period entitlements active until Apple grace expiration', async () => {
  const userId = '018fd4f2-1f3a-7c88-bc49-333333333333'
  const transactionExpiresDate = Date.now() - 24 * 60 * 60 * 1000
  const gracePeriodExpiresDate = Date.now() + 3 * 24 * 60 * 60 * 1000
  const savedEntitlementExpiresAts: Date[] = []
  const db = {
    appStoreTransaction: {
      upsert: mock(async () => ({ id: 'transaction-row-1' })),
    },
    subscriptionEntitlement: {
      findUnique: mock(async () => null),
      upsert: mock(async (args: { create: { expiresAt: Date | null } }) => {
        if (args.create.expiresAt) {
          savedEntitlementExpiresAts.push(args.create.expiresAt)
        }
        return {
          platform: 'ios',
          state: SubscriptionState.billing_grace_period,
          productId: 'premium_monthly',
          originalTransactionId: 'original-grace',
          transactionId: 'transaction-grace',
          expiresAt: args.create.expiresAt,
          willAutoRenew: true,
          updatedAt: new Date(),
        }
      }),
    },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  } as unknown as DbClient

  const subscription = await billingService({
    db,
    env,
    appStoreVerifier: {
      async verifyTransaction() {
        return {
          environment: Environment.SANDBOX,
          payload: {
            appAccountToken: userId,
            environment: Environment.SANDBOX,
            expiresDate: transactionExpiresDate,
            originalTransactionId: 'original-grace',
            productId: 'premium_monthly',
            purchaseDate: Date.now() - 30 * 24 * 60 * 60 * 1000,
            transactionId: 'transaction-grace',
            type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
          },
        }
      },
      async verifyRenewalInfo() {
        return {
          environment: Environment.SANDBOX,
          payload: {
            autoRenewProductId: 'premium_monthly',
            autoRenewStatus: 1,
            environment: Environment.SANDBOX,
            gracePeriodExpiresDate,
            originalTransactionId: 'original-grace',
            productId: 'premium_monthly',
          },
        }
      },
      async verifyNotification() {
        throw new Error('unexpected notification verification')
      },
      async getSubscriptionStatuses() {
        return [
          {
            status: Status.BILLING_GRACE_PERIOD,
            signedRenewalInfo: 'signed-renewal-grace',
            signedTransactionInfo: 'signed-transaction-grace',
          },
        ]
      },
    },
  }).reconcileAppStore({
    userId,
    originalTransactionIds: ['original-grace'],
  })

  expect(subscription).toMatchObject({
    isActive: true,
    state: 'billing_grace_period',
    expiresAt: new Date(gracePeriodExpiresDate).toISOString(),
  })
  expect(savedEntitlementExpiresAts[0]?.toISOString()).toBe(new Date(gracePeriodExpiresDate).toISOString())
})

test('status-only revoked transactions override future active entitlements for the same original transaction', async () => {
  const userId = '018fd4f2-1f3a-7c88-bc49-333333333333'
  const entitlementUpsert = mock(async () => ({
    platform: 'ios',
    state: SubscriptionState.revoked,
    productId: 'premium_monthly',
    originalTransactionId: 'original-revoked',
    transactionId: 'transaction-revoked',
    expiresAt: null,
    willAutoRenew: null,
    updatedAt: new Date(),
  }))
  const db = {
    appStoreTransaction: {
      upsert: mock(async () => ({ id: 'transaction-row-1' })),
    },
    subscriptionEntitlement: {
      findUnique: mock(async () => ({
        platform: 'ios',
        state: SubscriptionState.active,
        productId: 'premium_monthly',
        originalTransactionId: 'original-revoked',
        transactionId: 'transaction-active',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        willAutoRenew: true,
        updatedAt: new Date(),
      })),
      upsert: entitlementUpsert,
    },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  } as unknown as DbClient

  const subscription = await billingService({
    db,
    env,
    appStoreVerifier: {
      async verifyTransaction() {
        return {
          environment: Environment.SANDBOX,
          payload: {
            appAccountToken: userId,
            environment: Environment.SANDBOX,
            originalTransactionId: 'original-revoked',
            productId: 'premium_monthly',
            purchaseDate: Date.now() - 10 * 24 * 60 * 60 * 1000,
            transactionId: 'transaction-revoked',
            type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
          },
        }
      },
      async verifyRenewalInfo() {
        throw new Error('unexpected renewal verification')
      },
      async verifyNotification() {
        throw new Error('unexpected notification verification')
      },
      async getSubscriptionStatuses() {
        return [
          {
            status: Status.REVOKED,
            signedTransactionInfo: 'signed-transaction-revoked',
          },
        ]
      },
    },
  }).reconcileAppStore({
    userId,
    originalTransactionIds: ['original-revoked'],
  })

  expect(subscription).toMatchObject({
    isActive: false,
    state: 'revoked',
    transactionId: 'transaction-revoked',
  })
  expect(entitlementUpsert).toHaveBeenCalled()
})

test('allows tokenless first App Store claims only with a valid offer-code redemption token', async () => {
  const userId = '018fd4f2-1f3a-7c88-bc49-333333333333'
  const token = await billingService({ db: {} as DbClient, env }).createOfferCodeRedemption(userId)
  const createDb = () => {
    const db = {
      appStoreTransaction: {
        upsert: mock(async () => ({ id: 'transaction-row-1' })),
      },
      subscriptionEntitlement: {
        findUnique: mock(async () => null),
        upsert: mock(async () => ({
          platform: 'ios',
          state: SubscriptionState.active,
          productId: 'premium_monthly',
          originalTransactionId: 'original-offer-code',
          transactionId: 'transaction-offer-code',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          willAutoRenew: null,
          updatedAt: new Date(),
        })),
      },
      $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
    } as unknown as DbClient
    return db
  }
  let db = createDb()

  await expect(
    billingService({ db, env, appStoreVerifier: tokenlessOfferCodeVerifier() }).ingestAppStore({
      userId,
      signedTransactionInfo: 'signed-offer-code',
    }),
  ).rejects.toMatchObject({ code: 'IAP_OWNERSHIP_MISMATCH' })

  db = createDb()
  const invalidTokenError = await billingService({
    db,
    env,
    appStoreVerifier: tokenlessOfferCodeVerifier(),
  }).ingestAppStore({
    userId,
    signedTransactionInfo: 'signed-offer-code',
    offerCodeRedemptionToken: 'not-a-jwt',
  }).catch((error) => error)

  expect(invalidTokenError).toMatchObject({ code: 'IAP_OWNERSHIP_MISMATCH' })
  expect((invalidTokenError as { details?: unknown }).details).toBeUndefined()

  for (const [label, overrides] of [
    ['missing offer type', { offerType: undefined }],
    ['promotional offer type', { offerType: OfferType.PROMOTIONAL_OFFER }],
    ['missing offer identifier', { offerIdentifier: undefined }],
    ['blank offer identifier', { offerIdentifier: '   ' }],
  ] satisfies Array<[string, Partial<JWSTransactionDecodedPayload>]>) {
    db = createDb()
    await expect(
      billingService({
        db,
        env,
        appStoreVerifier: tokenlessOfferCodeVerifier(overrides),
      }).ingestAppStore({
        userId,
        signedTransactionInfo: `signed-offer-code-${label}`,
        offerCodeRedemptionToken: token,
      }),
    ).rejects.toMatchObject({ code: 'IAP_OWNERSHIP_MISMATCH' })
  }

  db = createDb()
  await expect(
    billingService({ db, env, appStoreVerifier: tokenlessOfferCodeVerifier() }).ingestAppStore({
      userId,
      signedTransactionInfo: 'signed-offer-code',
      offerCodeRedemptionToken: token,
    }),
  ).resolves.toMatchObject({
    isActive: true,
    state: 'active',
    transactionId: 'transaction-offer-code',
  })
})

test('rejects verified App Store transactions that are not auto-renewable subscriptions', async () => {
  const db = {
    appStoreTransaction: {
      upsert: mock(async () => ({ id: 'transaction-row-1' })),
    },
    subscriptionEntitlement: {
      findUnique: mock(async () => null),
      upsert: mock(async () => {
        throw new Error('unexpected entitlement write')
      }),
    },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  } as unknown as DbClient

  await expect(
    billingService({ db, env, appStoreVerifier: nonSubscriptionVerifier() }).ingestAppStore({
      userId: '018fd4f2-1f3a-7c88-bc49-333333333333',
      signedTransactionInfo: 'signed-consumable',
    }),
  ).rejects.toMatchObject({
    code: 'IAP_INVALID_TRANSACTION',
    message: 'App Store transaction is not an auto-renewable subscription',
  })
})

test('ingests active Google Play purchases and acknowledges before returning entitlement', async () => {
  const userId = '018fd4f2-1f3a-7c88-bc49-333333333333'
  const acknowledgeSubscription = mock(async () => undefined)
  const googleUpsert = mock(async () => ({ id: 'google-row-1' }))
  const entitlementUpsert = mock(async (args: { create: { platform: string; state: SubscriptionState } }) => ({
    platform: args.create.platform,
    state: args.create.state,
    productId: 'premium',
    originalTransactionId: null,
    transactionId: 'GPA.1234-5678-9012-34567',
    expiresAt: new Date('2099-07-01T00:00:00.000Z'),
    willAutoRenew: true,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  }))
  const db = googlePlayDb({
    entitlementFindUnique: mock(async () => null),
    entitlementUpsert,
    googleFindFirst: mock(async () => null),
    googleFindMany: mock(async () => []),
    googleUpsert,
  })

  const subscription = await billingService({
    db,
    env: googlePlayEnv,
    googlePlayVerifier: googlePlayVerifier({
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      acknowledgeSubscription,
    }),
  }).ingestGooglePlay({
    userId,
    productId: 'premium',
    basePlanId: 'monthly',
    purchaseToken: 'purchase-token',
  })

  expect(subscription).toMatchObject({
    isActive: true,
    platform: 'android',
    state: 'active',
    productId: 'premium',
    originalTransactionId: null,
    transactionId: 'GPA.1234-5678-9012-34567',
  })
  expect(acknowledgeSubscription).toHaveBeenCalledWith({
    productId: 'premium',
    purchaseToken: 'purchase-token',
  })
  expect(googleUpsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({
        acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        basePlanId: 'monthly',
        productId: 'premium',
      }),
    }),
  )
})

test('rejects Google Play purchases linked to another app user', async () => {
  const db = googlePlayDb({
    entitlementFindUnique: mock(async () => null),
    entitlementUpsert: mock(async () => {
      throw new Error('unexpected entitlement write')
    }),
    googleFindFirst: mock(async () => null),
    googleFindMany: mock(async () => []),
    googleUpsert: mock(async () => {
      throw new Error('unexpected Google row write')
    }),
  })

  await expect(
    billingService({
      db,
      env: googlePlayEnv,
      googlePlayVerifier: googlePlayVerifier({
        externalAccountId: '018fd4f2-1f3a-7c88-bc49-444444444444',
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      }),
    }).ingestGooglePlay({
      userId: '018fd4f2-1f3a-7c88-bc49-333333333333',
      productId: 'premium',
      basePlanId: 'monthly',
      purchaseToken: 'purchase-token',
    }),
  ).rejects.toMatchObject({ code: 'IAP_OWNERSHIP_MISMATCH' })
})

test('rejects Google Play purchases when backend base plans are not allowlisted', async () => {
  const db = googlePlayDb({
    entitlementFindUnique: mock(async () => null),
    entitlementUpsert: mock(async () => {
      throw new Error('unexpected entitlement write')
    }),
    googleFindFirst: mock(async () => null),
    googleFindMany: mock(async () => []),
    googleUpsert: mock(async () => {
      throw new Error('unexpected Google row write')
    }),
  })

  await expect(
    billingService({
      db,
      env: {
        ...googlePlayEnv,
        GOOGLE_PLAY_BASE_PLAN_IDS: [],
      },
      googlePlayVerifier: googlePlayVerifier(),
    }).ingestGooglePlay({
      userId: '018fd4f2-1f3a-7c88-bc49-333333333333',
      productId: 'premium',
      basePlanId: 'monthly',
      purchaseToken: 'purchase-token',
    }),
  ).rejects.toMatchObject({ code: 'IAP_NOT_CONFIGURED' })
})

test('does not grant pending Google Play purchases', async () => {
  const entitlementUpsert = mock(async (args: { create: { state: SubscriptionState } }) => ({
    platform: 'android',
    state: args.create.state,
    productId: 'premium',
    originalTransactionId: null,
    transactionId: null,
    expiresAt: null,
    willAutoRenew: null,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  }))
  const db = googlePlayDb({
    entitlementFindUnique: mock(async () => null),
    entitlementUpsert,
    googleFindFirst: mock(async () => null),
    googleFindMany: mock(async () => []),
    googleUpsert: mock(async () => ({ id: 'google-row-1' })),
  })

  const subscription = await billingService({
    db,
    env: googlePlayEnv,
    googlePlayVerifier: googlePlayVerifier({
      expiryTime: null,
      subscriptionState: 'SUBSCRIPTION_STATE_PENDING',
    }),
  }).ingestGooglePlay({
    userId: '018fd4f2-1f3a-7c88-bc49-333333333333',
    productId: 'premium',
    basePlanId: 'monthly',
    purchaseToken: 'purchase-token',
  })

  expect(subscription).toMatchObject({
    isActive: false,
    state: 'pending',
  })
})

test('does not let stale Google Play expiration overwrite a fresher active entitlement', async () => {
  const existingEntitlement = {
    platform: 'ios',
    state: SubscriptionState.active,
    productId: 'ios_premium',
    originalTransactionId: 'original-ios',
    transactionId: 'transaction-ios',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    willAutoRenew: true,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  }
  const entitlementUpsert = mock(async () => {
    throw new Error('unexpected entitlement overwrite')
  })
  const db = googlePlayDb({
    entitlementFindUnique: mock(async () => existingEntitlement),
    entitlementUpsert,
    googleFindFirst: mock(async () => ({ userId: '018fd4f2-1f3a-7c88-bc49-333333333333' })),
    googleFindMany: mock(async () => []),
    googleUpsert: mock(async () => ({ id: 'google-row-1' })),
  })

  const subscription = await billingService({
    db,
    env: googlePlayEnv,
    googlePlayVerifier: googlePlayVerifier({
      expiryTime: '2026-06-01T00:00:00.000Z',
      subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
    }),
  }).ingestGooglePlay({
    userId: '018fd4f2-1f3a-7c88-bc49-333333333333',
    productId: 'premium',
    basePlanId: 'monthly',
    purchaseToken: 'purchase-token',
  })

  expect(subscription).toMatchObject({
    isActive: true,
    platform: 'ios',
    transactionId: 'transaction-ios',
  })
  expect(entitlementUpsert).not.toHaveBeenCalled()
})

function billingService({
  appStoreVerifier = fakeVerifier(),
  db,
  env: appEnv = env,
  googlePlayVerifier: googleVerifier = googlePlayVerifier(),
}: {
  appStoreVerifier?: AppStoreSubscriptionVerifier
  db: DbClient
  env?: AppEnv
  googlePlayVerifier?: GooglePlaySubscriptionVerifier
}) {
  return new BillingService(
    createBillingDependencies({
      appStoreVerifier,
      db,
      env: appEnv,
      googlePlayVerifier: googleVerifier,
    }),
  )
}

function googlePlayVerifier({
  acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
  acknowledgeSubscription = mock(async () => undefined),
  externalAccountId = '018fd4f2-1f3a-7c88-bc49-333333333333',
  expiryTime = '2099-07-01T00:00:00.000Z',
  subscriptionState = 'SUBSCRIPTION_STATE_ACTIVE',
}: {
  acknowledgementState?: string
  acknowledgeSubscription?: ReturnType<typeof mock>
  externalAccountId?: string
  expiryTime?: string | null
  subscriptionState?: string
} = {}): GooglePlaySubscriptionVerifier {
  return {
    acknowledgeSubscription,
    async getSubscriptionPurchase() {
      return {
        acknowledgementState,
        externalAccountIdentifiers: {
          obfuscatedExternalAccountId: externalAccountId,
          obfuscatedExternalProfileId: externalAccountId,
        },
        latestOrderId: subscriptionState === 'SUBSCRIPTION_STATE_PENDING' ? null : 'GPA.1234-5678-9012-34567',
        lineItems: [
          {
            autoRenewingPlan: { autoRenewEnabled: true },
            expiryTime,
            offerDetails: {
              basePlanId: 'monthly',
            },
            productId: 'premium',
          },
        ],
        subscriptionState,
        testPurchase: {},
      }
    },
  }
}

function googlePlayDb({
  entitlementFindUnique,
  entitlementUpsert,
  googleFindFirst,
  googleFindMany,
  googleUpsert,
}: {
  entitlementFindUnique: ReturnType<typeof mock>
  entitlementUpsert: ReturnType<typeof mock>
  googleFindFirst: ReturnType<typeof mock>
  googleFindMany: ReturnType<typeof mock>
  googleUpsert: ReturnType<typeof mock>
}) {
  const db = {
    googlePlaySubscriptionPurchase: {
      findFirst: googleFindFirst,
      findMany: googleFindMany,
      upsert: googleUpsert,
    },
    subscriptionEntitlement: {
      findUnique: entitlementFindUnique,
      upsert: entitlementUpsert,
    },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  }
  return db as unknown as DbClient
}

function fakeVerifier(): AppStoreSubscriptionVerifier {
  const notification: ResponseBodyV2DecodedPayload = {
    notificationUUID: 'notification-1',
    notificationType: 'DID_RENEW',
    data: {
      environment: Environment.SANDBOX,
      signedTransactionInfo: 'signed-transaction',
      status: Status.ACTIVE,
    },
  }

  return {
    async verifyNotification() {
      return { environment: Environment.SANDBOX, payload: notification }
    },
    async verifyTransaction() {
      return {
        environment: Environment.SANDBOX,
        payload: {
          appAccountToken: '018fd4f2-1f3a-7c88-bc49-333333333333',
          environment: Environment.SANDBOX,
          expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
          originalTransactionId: 'original-1',
          productId: 'premium_monthly',
          purchaseDate: Date.now() - 60_000,
          transactionId: 'transaction-1',
          type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
        },
      }
    },
    async verifyRenewalInfo() {
      throw new Error('unexpected renewal verification')
    },
    async getSubscriptionStatuses() {
      return []
    },
  }
}

function tokenlessOfferCodeVerifier(
  overrides: Partial<JWSTransactionDecodedPayload> = {},
): AppStoreSubscriptionVerifier {
  return {
    async verifyTransaction() {
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
          ...overrides,
        },
      }
    },
    async verifyRenewalInfo() {
      throw new Error('unexpected renewal verification')
    },
    async verifyNotification() {
      throw new Error('unexpected notification verification')
    },
    async getSubscriptionStatuses() {
      return []
    },
  }
}

function nonSubscriptionVerifier(): AppStoreSubscriptionVerifier {
  return {
    async verifyTransaction() {
      return {
        environment: Environment.SANDBOX,
        payload: {
          appAccountToken: '018fd4f2-1f3a-7c88-bc49-333333333333',
          environment: Environment.SANDBOX,
          expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
          originalTransactionId: 'original-consumable',
          productId: 'premium_monthly',
          purchaseDate: Date.now() - 60_000,
          transactionId: 'transaction-consumable',
          type: Type.CONSUMABLE,
        },
      }
    },
    async verifyRenewalInfo() {
      throw new Error('unexpected renewal verification')
    },
    async verifyNotification() {
      throw new Error('unexpected notification verification')
    },
    async getSubscriptionStatuses() {
      return []
    },
  }
}
