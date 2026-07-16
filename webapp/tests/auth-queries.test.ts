import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'bun:test'

import {
  applyAuthenticatedSession,
  authQueryKeys,
  clearAuthenticatedSession,
  logoutAuthenticatedSession,
  sessionQueryKeys,
} from '../src/features/auth/queries'

const user = {
  id: 'user_1',
  email: 'user@example.com',
  displayName: null,
  createdAt: '2026-05-11T00:00:00.000Z',
}

test('auth query helpers keep access token and session-scoped cache in sync', async () => {
  const queryClient = new QueryClient()
  let accessToken: string | null = null

  queryClient.setQueryData([...sessionQueryKeys.all, 'orders'], [{ id: 'old-order' }])
  queryClient.setQueryData(['public', 'plans'], [{ id: 'free' }])

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

  expect(queryClient.getQueryData([...sessionQueryKeys.all, 'orders'])).toBeUndefined()

  await clearAuthenticatedSession(queryClient, (nextAccessToken) => {
    accessToken = nextAccessToken
  })

  expect(accessToken).toBeNull()
  expect(queryClient.getQueryData(authQueryKeys.me())).toBeUndefined()
  expect(queryClient.getQueryData(['public', 'plans'])).toEqual([{ id: 'free' }])
})

test('failed server logout keeps the authenticated browser state intact', async () => {
  const queryClient = new QueryClient()
  let accessToken: string | null = 'active-access-token'
  queryClient.setQueryData([...sessionQueryKeys.all, 'orders'], [{ id: 'order-1' }])

  await expect(
    logoutAuthenticatedSession({
      api: {
        logout: async () => {
          throw new Error('network unavailable')
        },
      },
      queryClient,
      setAccessToken: (nextAccessToken) => {
        accessToken = nextAccessToken
      },
    }),
  ).rejects.toThrow('network unavailable')

  expect(accessToken).toBe('active-access-token')
  expect(queryClient.getQueryData([...sessionQueryKeys.all, 'orders'])).toEqual([{ id: 'order-1' }])
})

test('stale logout completion cannot clear a newer session epoch', async () => {
  const queryClient = new QueryClient()
  let accessToken: string | null = 'new-session-access-token'
  queryClient.setQueryData([...sessionQueryKeys.all, 'orders'], [{ id: 'order-1' }])

  await logoutAuthenticatedSession({
    api: {
      logout: async () => ({ data: undefined, sessionEpoch: 'old-session' }),
      isSessionEpochCurrent: () => false,
    },
    queryClient,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
  })

  expect(accessToken).toBe('new-session-access-token')
  expect(queryClient.getQueryData([...sessionQueryKeys.all, 'orders'])).toEqual([{ id: 'order-1' }])
})

test('session cleanup does not wait on the authenticated query it cancels', async () => {
  const queryClient = new QueryClient()
  let releaseQuery!: () => void
  const queryCanFinish = new Promise<void>((resolve) => {
    releaseQuery = resolve
  })
  const inFlightQuery = queryClient.fetchQuery({
    queryKey: authQueryKeys.me(),
    queryFn: async () => {
      await queryCanFinish
      return { user }
    },
  })

  await Promise.resolve()
  await clearAuthenticatedSession(queryClient, () => undefined)

  expect(queryClient.getQueryData(authQueryKeys.me())).toBeUndefined()
  releaseQuery()
  await inFlightQuery.catch(() => undefined)
})
