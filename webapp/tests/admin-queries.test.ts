import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, expect, test } from 'bun:test'

import { adminUsersQueryOptions } from '../src/features/admin/queries'
import { AuthApi } from '../src/features/auth/api'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('switching the admin users query key aborts the request still in flight for the old key', async () => {
  const inFlight: Array<{ page: number; signal: AbortSignal | null | undefined; respond: () => void }> = []

  globalThis.fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(String(input))
      const page = Number(url.searchParams.get('page'))
      const signal = init?.signal
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      inFlight.push({ page, signal, respond: () => resolve(json(usersPage(page), 200)) })
    })

  const api = new AuthApi({
    getAccessToken: () => 'admin-access-token',
    setAccessToken: () => undefined,
  })
  const transport = { request: api.requestAuthenticated.bind(api) }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const observer = new QueryObserver(
    queryClient,
    adminUsersQueryOptions(transport, { page: 1, pageSize: 20 }),
  )
  const unsubscribe = observer.subscribe(() => undefined)
  await waitFor(() => inFlight.length === 1)

  observer.setOptions(adminUsersQueryOptions(transport, { page: 2, pageSize: 20 }))
  await waitFor(() => inFlight.length === 2)

  expect(inFlight[0]?.page).toBe(1)
  expect(inFlight[0]?.signal?.aborted).toBe(true)
  expect(inFlight[1]?.page).toBe(2)
  expect(inFlight[1]?.signal?.aborted).toBe(false)

  inFlight[1]?.respond()
  await waitFor(() => observer.getCurrentResult().isSuccess)

  expect(observer.getCurrentResult().data?.page).toBe(2)
  unsubscribe()
  queryClient.clear()
})

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error('Timed out waiting for the expected state')
}

function usersPage(page: number) {
  return {
    items: [
      {
        id: `user_${page}`,
        email: `user${page}@example.com`,
        displayName: null,
        role: 'user',
        createdAt: '2026-05-11T00:00:00.000Z',
      },
    ],
    page,
    pageSize: 20,
    total: 40,
    hasNext: page < 2,
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
