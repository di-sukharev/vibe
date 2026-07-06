import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'bun:test'

import {
  applyAuthenticatedSession,
  authQueryKeys,
  clearAuthenticatedSession,
} from '../src/lib/auth-queries'

const user = {
  id: 'user_1',
  email: 'user@example.com',
  displayName: null,
  createdAt: '2026-05-11T00:00:00.000Z',
}

test('auth query helpers keep access token memory and current-user cache in sync', () => {
  const queryClient = new QueryClient()
  let accessToken: string | null = null

  applyAuthenticatedSession(
    queryClient,
    (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    {
      accessToken: 'fresh-access-token',
      user,
    },
  )

  expect(accessToken).toBe('fresh-access-token')
  expect(queryClient.getQueryData(authQueryKeys.me())).toEqual({ user })

  clearAuthenticatedSession(queryClient, (nextAccessToken) => {
    accessToken = nextAccessToken
  })

  expect(accessToken).toBeNull()
  expect(queryClient.getQueryData(authQueryKeys.me())).toBeUndefined()
})
