import { describe, expect, test } from 'bun:test'

import {
  effectiveSubscriptionState,
  resolveGooglePlaySubscriptionState,
  shouldUpdateEntitlement,
} from './subscription'

const now = new Date('2026-07-10T12:00:00.000Z')

describe('billing subscription decisions', () => {
  test('derives effective state from the explicit decision time', () => {
    expect(
      effectiveSubscriptionState(
        { state: 'active', expiresAt: new Date('2026-07-10T11:59:59.000Z') },
        now,
      ),
    ).toBe('expired')
    expect(
      effectiveSubscriptionState(
        { state: 'billing_grace_period', expiresAt: new Date('2026-07-10T12:00:01.000Z') },
        now,
      ),
    ).toBe('billing_grace_period')
  })

  test('maps Google lifecycle without reading the system clock', () => {
    expect(
      resolveGooglePlaySubscriptionState(
        'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
        new Date('2026-07-10T12:00:01.000Z'),
        now,
      ),
    ).toBe('billing_grace_period')
    expect(
      resolveGooglePlaySubscriptionState(
        'SUBSCRIPTION_STATE_ACTIVE',
        new Date('2026-07-10T11:59:59.000Z'),
        now,
      ),
    ).toBe('expired')
  })

  test('keeps a fresh active entitlement over a stale unrelated transaction', () => {
    expect(
      shouldUpdateEntitlement({
        existing: {
          platform: 'ios',
          state: 'active',
          productId: 'premium',
          originalTransactionId: 'original-new',
          transactionId: 'transaction-new',
          expiresAt: new Date('2026-08-10T00:00:00.000Z'),
          willAutoRenew: true,
          updatedAt: now,
        },
        incoming: {
          platform: 'android',
          state: 'expired',
          originalTransactionId: null,
          transactionId: 'transaction-old',
          purchaseDate: new Date('2026-06-01T00:00:00.000Z'),
          expiresAt: new Date('2026-07-01T00:00:00.000Z'),
          revokedAt: null,
        },
        now,
      }),
    ).toBe(false)
  })
})
