import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AccountSummary } from '../src/features/users/AccountSummary'
import { formatDate } from '../src/platform/intl'

// Noon UTC: `bun test` runs in UTC unless the shell exports TZ, and even then every zone within
// eleven hours of UTC still lands on the same calendar day.
const createdAt = '2026-03-05T12:00:00.000Z'

test('formatDate renders a timestamp as an English medium date', () => {
  expect(formatDate(createdAt)).toBe('Mar 5, 2026')
  expect(formatDate(new Date(createdAt))).toBe('Mar 5, 2026')
})

test('AccountSummary shows the member-since date through the shared formatter', () => {
  const markup = renderToStaticMarkup(
    createElement(AccountSummary, {
      user: {
        avatarUrl: null,
        createdAt,
        displayName: 'Jane Doe',
        email: 'jane@example.com',
        id: 'user-1',
        role: 'user',
      },
    }),
  )

  expect(markup).toContain('Mar 5, 2026')
})
