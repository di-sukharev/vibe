import { expect, test } from 'bun:test'

import { clearPasswordResetTokenHash } from '../src/features/auth/password-reset-location'

test('password reset token cleanup preserves router-managed history state', () => {
  const routerState = { __TSR_index: 4, key: 'reset-entry' }
  const replacements: Array<{ state: unknown; title: string; url?: string | URL | null }> = []

  clearPasswordResetTokenHash(
    {
      hash: '#token=secret',
      pathname: '/reset-password',
      search: '?campaign=welcome',
    },
    {
      state: routerState,
      replaceState: (state, title, url) => {
        replacements.push({ state, title, url })
      },
    },
  )

  expect(replacements).toEqual([
    {
      state: routerState,
      title: '',
      url: '/reset-password?campaign=welcome',
    },
  ])
})
