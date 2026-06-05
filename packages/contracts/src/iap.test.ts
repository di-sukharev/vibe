import { describe, expect, test } from 'bun:test'

import {
  appStoreOfferCodeRedemptionResponseSchema,
  appStoreReconcileRequestSchema,
  appStoreTransactionRequestSchema,
  appStoreWebhookRequestSchema,
  googlePlayReconcileRequestSchema,
  googlePlayTransactionRequestSchema,
  iapEntitlementResponseSchema,
  subscriptionSnapshotSchema,
} from './iap'

const inactiveSubscription = {
  entitlement: 'premium',
  isActive: false,
  state: 'inactive',
  platform: null,
  productId: null,
  originalTransactionId: null,
  transactionId: null,
  expiresAt: null,
  willAutoRenew: null,
  updatedAt: null,
} as const

describe('iap contracts', () => {
  test('parses inactive and active subscription snapshots', () => {
    expect(subscriptionSnapshotSchema.parse(inactiveSubscription)).toEqual(inactiveSubscription)

    expect(
      subscriptionSnapshotSchema.parse({
        entitlement: 'premium',
        isActive: true,
        state: 'active',
        platform: 'android',
        productId: 'com.example.premium.monthly',
        originalTransactionId: null,
        transactionId: 'GPA.1234-5678-9012-34567',
        expiresAt: '2026-06-01T00:00:00.000Z',
        willAutoRenew: true,
        updatedAt: '2026-05-19T00:00:00.000Z',
      }),
    ).toMatchObject({
      isActive: true,
      state: 'active',
      platform: 'android',
    })
  })

  test('validates App Store transaction and reconcile payloads', () => {
    expect(
      appStoreTransactionRequestSchema.parse({
        offerCodeRedemptionToken: 'redemption-token',
        signedTransactionInfo: 'signed-jws',
      }),
    ).toEqual({
      offerCodeRedemptionToken: 'redemption-token',
      signedTransactionInfo: 'signed-jws',
    })

    expect(
      appStoreReconcileRequestSchema.parse({
        signedTransactions: ['signed-jws'],
        originalTransactionIds: ['original-transaction-id'],
      }),
    ).toEqual({
      signedTransactions: ['signed-jws'],
      originalTransactionIds: ['original-transaction-id'],
    })

    expect(() => appStoreReconcileRequestSchema.parse({})).toThrow()
  })

  test('validates Google Play transaction and reconcile payloads', () => {
    expect(
      googlePlayTransactionRequestSchema.parse({
        basePlanId: 'monthly',
        productId: 'premium',
        purchaseToken: 'purchase-token',
      }),
    ).toEqual({
      basePlanId: 'monthly',
      productId: 'premium',
      purchaseToken: 'purchase-token',
    })

    expect(
      googlePlayReconcileRequestSchema.parse({
        purchases: [
          {
            productId: 'premium',
            purchaseToken: 'purchase-token',
          },
        ],
      }),
    ).toEqual({
      purchases: [
        {
          productId: 'premium',
          purchaseToken: 'purchase-token',
        },
      ],
    })

    expect(googlePlayReconcileRequestSchema.parse({})).toEqual({})
    expect(googlePlayReconcileRequestSchema.parse(undefined)).toEqual({})
  })

  test('validates entitlement and webhook payloads', () => {
    expect(iapEntitlementResponseSchema.parse({ subscription: inactiveSubscription })).toEqual({
      subscription: inactiveSubscription,
    })

    expect(appStoreWebhookRequestSchema.parse({ signedPayload: 'payload' })).toEqual({
      signedPayload: 'payload',
    })

    expect(appStoreOfferCodeRedemptionResponseSchema.parse({ token: 'redemption-token' })).toEqual({
      token: 'redemption-token',
    })
  })
})
