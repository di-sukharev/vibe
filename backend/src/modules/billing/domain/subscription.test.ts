import { describe, expect, test } from 'bun:test'

import {
  effectiveSubscriptionState,
  resolveGooglePlaySubscriptionState,
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

})
