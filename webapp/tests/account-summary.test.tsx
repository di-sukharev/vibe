import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AccountSummary } from '../src/features/users/AccountSummary'

test('account summary renders the subscription supplied by the mobile backend', () => {
  const markup = renderToStaticMarkup(
    <AccountSummary
      user={{
        id: 'user-1',
        email: 'user@example.com',
        displayName: 'Demo User',
        role: 'user',
        createdAt: '2026-07-20T00:00:00.000Z',
        subscription: {
          entitlement: 'premium',
          isActive: true,
          state: 'active',
          platform: 'ios',
          productId: 'premium.monthly',
          originalTransactionId: 'original-1',
          transactionId: 'transaction-1',
          expiresAt: '2026-08-20T00:00:00.000Z',
          willAutoRenew: true,
          updatedAt: '2026-07-20T00:00:00.000Z',
        },
      }}
    />,
  )

  expect(markup).toContain('Premium · Active')
  expect(markup).toContain('iOS · premium.monthly')
  expect(markup).not.toContain('Not configured')
})
