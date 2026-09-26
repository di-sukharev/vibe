import { afterEach, expect, test } from 'bun:test'

import { AuthApi } from '../src/features/auth/api'
import { bootstrapAuthSession } from '../src/features/auth/bootstrap'
import { publishBrowserSessionState } from '../src/features/auth/session-coordinator'
import { ApiRequestError } from '../src/platform/api'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('AuthApi refreshes and retries authenticated requests with the new access token', async () => {
  const expiredAccessToken = accessTokenFor('user_1', 'expired')
  const freshAccessToken = accessTokenFor('user_1', 'fresh')
  const requests = fakeBackend(({ path }) => {
    if (path === '/api/auth/refresh') return json({ accessToken: freshAccessToken }, 200)
    if (path !== '/api/auth/me') return unexpectedRequest()
    return requests.filter((request) => request.path === '/api/auth/me').length === 1
      ? expiredAccessTokenError()
      : currentUser()
  })
  const { client } = authClient(expiredAccessToken)

  const response = await client.me()
  const meRequests = requests.filter((request) => request.path === '/api/auth/me')

  expect(response.user.email).toBe('user@example.com')
  expect(meRequests.map((request) => request.authorization)).toEqual([
    `Bearer ${expiredAccessToken}`,
    `Bearer ${freshAccessToken}`,
  ])
})

test('AuthApi shares one refresh across concurrent unauthorized requests', async () => {
  const expiredAccessToken = accessTokenFor('user_1', 'expired')
  const freshAccessToken = accessTokenFor('user_1', 'fresh')
  const requests = fakeBackend(async ({ path, authorization }) => {
    if (path === '/api/auth/refresh') {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return json({ accessToken: freshAccessToken }, 200)
    }
    if (path !== '/api/auth/me') return unexpectedRequest()
    return authorization === `Bearer ${freshAccessToken}` ? currentUser() : expiredAccessTokenError()
  })
  const { client } = authClient(expiredAccessToken)

  const [first, second] = await Promise.all([client.me(), client.me()])
  const meRequests = requests.filter((request) => request.path === '/api/auth/me')

  expect(first.user.email).toBe('user@example.com')
  expect(second.user.email).toBe('user@example.com')
  expect(requests.filter((request) => request.path === '/api/auth/refresh')).toHaveLength(1)
  expect(meRequests).toHaveLength(4)
  expect(meRequests.filter((request) => request.authorization === `Bearer ${expiredAccessToken}`)).toHaveLength(2)
  expect(meRequests.filter((request) => request.authorization === `Bearer ${freshAccessToken}`)).toHaveLength(2)
  expect(requests.every((request) => request.init?.credentials === 'include')).toBe(true)
})

test('AuthApi clears only local session state when refresh is unauthorized', async () => {
  const requests = fakeBackend(({ path }) => {
    if (path === '/api/auth/me') return expiredAccessTokenError()
    if (path === '/api/auth/refresh') return apiError(401, 'UNAUTHORIZED', 'Invalid refresh token')
    return unexpectedRequest()
  })
  const { client, session } = authClient('expired-access-token')

  await expect(client.me()).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHORIZED',
  })

  expect(session.accessToken).toBeNull()
  expect(session.authExpiredCalls).toBe(1)
  expect(paths(requests)).toEqual([
    '/api/auth/me',
    '/api/auth/refresh',
  ])
})

test('AuthApi preserves the session when refresh fails transiently', async () => {
  fakeBackend(({ path }) => {
    if (path === '/api/auth/me') return expiredAccessTokenError()
    if (path === '/api/auth/refresh') return apiError(503, 'UNAVAILABLE', 'Try again later')
    return unexpectedRequest()
  })
  const { client, session } = authClient('expired-access-token')

  await expect(client.me()).rejects.toMatchObject({ status: 503 })
  expect(session.accessToken).toBe('expired-access-token')
  expect(session.authExpiredCalls).toBe(0)
})

test('AuthApi never refreshes an old request after another session epoch wins', async () => {
  publishBrowserSessionState('authenticated')
  const { client, session } = authClient('account-a-access-token')

  publishBrowserSessionState('authenticated')
  const requests = fakeBackend(() => expiredAccessTokenError())

  await expect(client.me()).rejects.toMatchObject({ status: 401 })
  expect(paths(requests)).toEqual(['/api/auth/me'])
  expect(session.accessToken).toBe('account-a-access-token')
  expect(session.authExpiredCalls).toBe(0)
})

test('a late refresh 401 cannot clear a newer browser session epoch', async () => {
  const refresh = deferred()
  publishBrowserSessionState('authenticated')

  const requests = fakeBackend(async ({ path }) => {
    if (path === '/api/auth/refresh') {
      await refresh.promise
      return apiError(401, 'UNAUTHORIZED', 'Old refresh failed')
    }
    return expiredAccessTokenError()
  })
  const { client, session } = authClient('account-a-access-token')
  const request = client.me()
  await waitForRequest(requests, '/api/auth/refresh')
  publishBrowserSessionState('authenticated')
  refresh.resolve()

  await expect(request).rejects.toMatchObject({ status: 401 })
  expect(session.accessToken).toBe('account-a-access-token')
  expect(session.authExpiredCalls).toBe(0)
})

test('AuthApi discards a successful response from an older browser session epoch', async () => {
  const response = deferred()
  publishBrowserSessionState('authenticated')

  const requests = fakeBackend(async () => {
    await response.promise
    return currentUser('account-a', 'account-a@example.com')
  })
  const { client } = authClient(accessTokenFor('account-a', 'current'))
  const request = client.me()
  await waitForRequest(requests, '/api/auth/me')
  publishBrowserSessionState('authenticated')
  response.resolve()

  await expect(request).rejects.toThrow('Browser auth session changed')
})

test('AuthApi never retries an authenticated request as a different principal', async () => {
  publishBrowserSessionState('authenticated')

  const requests = fakeBackend(({ path }) =>
    path === '/api/auth/refresh'
      ? json({ accessToken: accessTokenFor('account-b', 'fresh') }, 200)
      : expiredAccessTokenError(),
  )
  const { client, session } = authClient(accessTokenFor('account-a', 'expired'))

  await expect(client.me()).rejects.toMatchObject({ status: 401 })
  expect(paths(requests)).toEqual(['/api/auth/me', '/api/auth/refresh'])
  expect(session.accessToken).toBeNull()
  expect(session.authExpiredCalls).toBe(1)
})

test('AuthApi preserves backend error status, code, and message', async () => {
  fakeBackend(({ path }) =>
    path === '/api/auth/register'
      ? apiError(409, 'CONFLICT', 'User with this email already exists')
      : unexpectedRequest(),
  )
  const { client } = authClient(null)

  await expect(
    client.register({
      email: 'dupe@example.com',
      password: 'password123',
    }),
  ).rejects.toMatchObject({
    status: 409,
    code: 'CONFLICT',
    message: 'User with this email already exists',
  })
})

test('AuthApi submits password reset requests and clears session state after confirmation', async () => {
  const requests = fakeBackend(({ path }) => {
    if (path === '/api/auth/password-reset/request') return json({ accepted: true }, 202)
    if (path === '/api/auth/password-reset/confirm') return new Response(null, { status: 204 })
    return unexpectedRequest()
  })
  const { client, session } = authClient('existing-access-token')

  await expect(
    client.requestPasswordReset({ email: ' USER@Example.COM ' }),
  ).resolves.toEqual({ accepted: true })
  await expect(
    client.confirmPasswordReset({
      token: 't'.repeat(43),
      password: 'new-password-123',
    }),
  ).resolves.toMatchObject({ data: undefined, sessionEpoch: expect.any(String) })
  expect(
    requests.map(({ init, path }) => ({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })),
  ).toEqual([
    {
      path: '/api/auth/password-reset/request',
      body: { email: 'user@example.com' },
    },
    {
      path: '/api/auth/password-reset/confirm',
      body: { token: 't'.repeat(43), password: 'new-password-123' },
    },
  ])
  expect(session.accessToken).toBeNull()
})

test('AuthApi clearSession does not revoke a possibly newer shared browser cookie', async () => {
  const requests = fakeBackend(() => unexpectedRequest())
  const { client, session } = authClient('stale-access-token')

  await client.clearSession()

  expect(session.accessToken).toBeNull()
  expect(session.authExpiredCalls).toBe(1)
  expect(requests).toEqual([])
})

test('bootstrapAuthSession clears local state only for an unauthorized refresh', async () => {
  const events: string[] = []
  let completed = false
  const cleanup = deferred()

  const bootstrap = bootstrapAuthSession({
    api: {
      refresh: async () => {
        events.push('refresh')
        throw new ApiRequestError(401, 'UNAUTHORIZED', 'Invalid refresh token')
      },
      clearSession: async () => {
        events.push('cleanup:start')
        await cleanup.promise
        events.push('cleanup:done')
      },
    },
    shouldApply: () => true,
    setAccessToken: () => {
      events.push('setAccessToken')
    },
  }).then(() => {
    completed = true
  })

  await waitFor(() => events.includes('cleanup:start'), 'cleanup:start')

  expect(completed).toBe(false)
  expect(events).toEqual(['refresh', 'cleanup:start'])

  cleanup.resolve()
  await bootstrap

  expect(completed).toBe(true)
  expect(events).toEqual(['refresh', 'cleanup:start', 'cleanup:done'])
})

test('bootstrapAuthSession surfaces transient refresh failures without clearing session state', async () => {
  let cleared = false

  await expect(
    bootstrapAuthSession({
      api: {
        refresh: async () => {
          throw new ApiRequestError(503, 'UNAVAILABLE', 'Try again later')
        },
        clearSession: async () => {
          cleared = true
        },
      },
      shouldApply: () => true,
      setAccessToken: () => undefined,
    }),
  ).rejects.toMatchObject({ status: 503 })

  expect(cleared).toBe(false)
})

test('AuthApi surfaces an aborted request as its AbortError, never as an expired session', async () => {
  const controller = new AbortController()
  const requests = fakeBackend(({ init, path }) =>
    // A 401 whose error body is still streaming when the caller aborts: the browser errors the
    // body with the abort reason, so the JSON payload never fully arrives.
    path === '/api/auth/me'
      ? new Response(bodyThatErrorsOnAbort(init?.signal), { status: 401 })
      : unexpectedRequest(),
  )
  const { client, session } = authClient('active-access-token')
  const request = client.me({ signal: controller.signal })
  await waitForRequest(requests, '/api/auth/me')
  controller.abort()

  const error = await rejectionOf(request)
  expect(error).toBeInstanceOf(DOMException)
  expect((error as DOMException).name).toBe('AbortError')
  expect(paths(requests)).toEqual(['/api/auth/me'])
  expect(session.accessToken).toBe('active-access-token')
  expect(session.authExpiredCalls).toBe(0)
})

test('one caller aborting its request does not cancel the refresh other callers share', async () => {
  const expiredAccessToken = accessTokenFor('user_1', 'expired')
  const freshAccessToken = accessTokenFor('user_1', 'fresh')
  const refresh = deferred()
  const controller = new AbortController()

  const requests = fakeBackend(async ({ authorization, init, path }) => {
    // Like the browser, refuse to start a request whose signal is already aborted.
    init?.signal?.throwIfAborted()

    if (path === '/api/auth/refresh') {
      // Also like the browser: had the caller's signal leaked into this request, the abort below
      // would fail the refresh for everyone waiting on it.
      await Promise.race([refresh.promise, untilAborted(init?.signal)])
      return json({ accessToken: freshAccessToken }, 200)
    }
    return authorization === `Bearer ${freshAccessToken}` ? currentUser() : expiredAccessTokenError()
  })
  const { client, session } = authClient(expiredAccessToken)
  const abortedRequest = client.me({ signal: controller.signal })
  const keptRequest = client.me()
  await waitForRequest(requests, '/api/auth/refresh')
  controller.abort()
  refresh.resolve()

  const error = await rejectionOf(abortedRequest)
  expect(error).toBeInstanceOf(DOMException)
  expect((error as DOMException).name).toBe('AbortError')
  await expect(keptRequest).resolves.toMatchObject({ user: { email: 'user@example.com' } })
  expect(requests.filter((request) => request.path === '/api/auth/refresh')).toHaveLength(1)
  expect(session.accessToken).toBe(freshAccessToken)
  expect(session.authExpiredCalls).toBe(0)
})

type FakeRequest = {
  path: string
  authorization: string | null
  init: RequestInit | undefined
}

/** Replaces `fetch` with `respond` and returns the live list of requests it received. */
function fakeBackend(respond: (request: FakeRequest) => Response | Promise<Response>) {
  const requests: FakeRequest[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = {
      path: new URL(String(input)).pathname,
      authorization: new Headers(init?.headers).get('Authorization'),
      init,
    }
    requests.push(request)
    return respond(request)
  }) as typeof fetch

  return requests
}

function paths(requests: FakeRequest[]) {
  return requests.map((request) => request.path)
}

/** An AuthApi whose access token and expiry notifications are observable through `session`. */
function authClient(initialAccessToken: string | null) {
  const session = { accessToken: initialAccessToken, authExpiredCalls: 0 }
  const client = new AuthApi({
    getAccessToken: () => session.accessToken,
    setAccessToken: (nextAccessToken) => {
      session.accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      session.authExpiredCalls += 1
    },
  })

  return { client, session }
}

function currentUser(id = 'user_1', email = 'user@example.com') {
  return json(
    {
      user: {
        id,
        email,
        displayName: null,
        role: 'user',
        createdAt: '2026-05-11T00:00:00.000Z',
      },
    },
    200,
  )
}

function expiredAccessTokenError() {
  return apiError(401, 'UNAUTHORIZED', 'Expired access token')
}

function unexpectedRequest() {
  return apiError(404, 'NOT_FOUND', 'Unexpected request')
}

function apiError(status: number, code: string, message: string) {
  return json({ error: { code, message } }, status)
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected the promise to reject')
}

function untilAborted(signal: AbortSignal | null | undefined) {
  return new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function bodyThatErrorsOnAbort(signal: AbortSignal | null | undefined) {
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true })
    },
  })
}

function waitForRequest(requests: FakeRequest[], path: string) {
  return waitFor(() => requests.some((request) => request.path === path), path)
}

async function waitFor(condition: () => boolean, description: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Timed out waiting for: ${description}`)
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function accessTokenFor(subject: string, version: string) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject, version })}.signature`
}
