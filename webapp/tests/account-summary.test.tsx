import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AccountSummary } from '../src/features/users/AccountSummary'

test('account summary reports identity and role without advertising billing', () => {
  const markup = renderToStaticMarkup(
    <AccountSummary
      user={{
        id: 'user-1',
        email: 'user@example.com',
        displayName: 'Demo User',
        role: 'user',
        createdAt: '2026-07-20T00:00:00.000Z',
      }}
    />,
  )

  expect(markup).toContain('Demo User')
  expect(markup).toContain('user@example.com')
  expect(markup).toContain('Workspace role: User')
  // Store subscriptions belong to the mobile app; the browser client must not imply it manages them.
  expect(markup).not.toContain('Subscription')
})
