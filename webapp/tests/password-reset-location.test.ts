import { expect, test } from 'bun:test'

import {
  clearPasswordResetTokenHash,
  readPasswordResetToken,
} from '../src/features/auth/password-reset-location'

test('password reset token is read from the URL hash', () => {
  expect(readPasswordResetToken({ hash: '#token=secret' })).toBe('secret')
})

test('password reset token is empty when there is no hash', () => {
  expect(readPasswordResetToken({ hash: '' })).toBe('')
})

test('password reset token is empty when the hash has no token param', () => {
  expect(readPasswordResetToken({ hash: '#campaign=welcome' })).toBe('')
})

test('password reset token is read regardless of param order or extra params', () => {
  expect(readPasswordResetToken({ hash: '#campaign=welcome&token=secret' })).toBe('secret')
})

test('password reset token is URL-decoded', () => {
  expect(readPasswordResetToken({ hash: '#token=a%2Fb%3Dc' })).toBe('a/b=c')
})

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
