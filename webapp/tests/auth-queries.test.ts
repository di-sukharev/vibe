import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'bun:test'

import { adminDashboardQueryOptions, adminUsersQueryOptions } from '../src/features/admin/queries'
import {
  applyAuthenticatedSession,
  authQueryKeys,
  clearAuthenticatedSession,
  confirmPasswordResetAndClearSession,
  currentUserQueryOptions,
  logoutAuthenticatedSession,
  sessionQueryKeys,
} from '../src/features/auth/queries'
import { avatarQueryOptions } from '../src/features/avatar/queries'
import type { HttpRequestOptions } from '../src/platform/api'

const user = {
  id: 'user_1',
  email: 'user@example.com',
  displayName: null,
  role: 'user',
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

test('password reset confirmation clears the current authenticated client session', async () => {
  const queryClient = new QueryClient()
  let accessToken: string | null = 'active-access-token'
  let submittedInput: { token: string; password: string } | undefined
  queryClient.setQueryData(authQueryKeys.me(), { user })
  queryClient.setQueryData([...sessionQueryKeys.all, 'orders'], [{ id: 'order-1' }])

  await confirmPasswordResetAndClearSession({
    api: {
      confirmPasswordReset: async (input) => {
        submittedInput = input
        return { data: undefined, sessionEpoch: 'reset-session' }
      },
      isSessionEpochCurrent: (sessionEpoch) => sessionEpoch === 'reset-session',
    },
    input: {
      token: 't'.repeat(43),
      password: 'new-password-123',
    },
    queryClient,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
  })

  expect(submittedInput).toEqual({
    token: 't'.repeat(43),
    password: 'new-password-123',
  })
  expect(accessToken).toBeNull()
  expect(queryClient.getQueryData(authQueryKeys.me())).toBeUndefined()
  expect(queryClient.getQueryData([...sessionQueryKeys.all, 'orders'])).toBeUndefined()
})

test('stale password reset completion cannot clear a newer client session', async () => {
  const queryClient = new QueryClient()
  let accessToken: string | null = 'new-session-access-token'
  queryClient.setQueryData(authQueryKeys.me(), { user })
  queryClient.setQueryData([...sessionQueryKeys.all, 'orders'], [{ id: 'order-1' }])

  await confirmPasswordResetAndClearSession({
    api: {
      confirmPasswordReset: async () => ({ data: undefined, sessionEpoch: 'old-session' }),
      isSessionEpochCurrent: () => false,
    },
    input: {
      token: 't'.repeat(43),
      password: 'new-password-123',
    },
    queryClient,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
  })

  expect(accessToken).toBe('new-session-access-token')
  expect(queryClient.getQueryData(authQueryKeys.me())).toEqual({ user })
  expect(queryClient.getQueryData([...sessionQueryKeys.all, 'orders'])).toEqual([
    { id: 'order-1' },
  ])
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

test('every session-scoped query forwards its abort signal and is removed by session cleanup', async () => {
  const queryClient = new QueryClient()
  const signals: unknown[] = []
  const transport = {
    request: async (_path: string, _schema: unknown, options?: HttpRequestOptions) => {
      signals.push(options?.signal)
      return {} as never
    },
  }
  const api = {
    me: async (options?: { signal?: AbortSignal }) => {
      signals.push(options?.signal)
      return { user: { ...user, role: 'user' as const } }
    },
  }
  const sessionQueries = [
    currentUserQueryOptions(api),
    adminDashboardQueryOptions(transport),
    adminUsersQueryOptions(transport, { page: 1, pageSize: 20 }),
    avatarQueryOptions(transport),
  ] as const

  await queryClient.fetchQuery(sessionQueries[0])
  await queryClient.fetchQuery(sessionQueries[1])
  await queryClient.fetchQuery(sessionQueries[2])
  await queryClient.fetchQuery(sessionQueries[3])

  expect(signals).toHaveLength(sessionQueries.length)
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true)

  await clearAuthenticatedSession(queryClient, () => undefined)

  for (const { queryKey } of sessionQueries) {
    expect(queryClient.getQueryData(queryKey)).toBeUndefined()
  }
})
