import { afterEach, expect, test } from 'bun:test'

import { AuthApi } from '../src/features/auth/api'
import { bootstrapAuthSession } from '../src/features/auth/bootstrap'
import { createBrowserAuthCoordinator } from '../src/features/auth/browser-auth-coordinator'
import { publishBrowserSessionState } from '../src/features/auth/session-coordinator'
import { ApiRequestError } from '../src/platform/api'

const originalFetch = globalThis.fetch
const inactiveSubscription = {
  entitlement: 'premium',
  isActive: false,
  state: 'inactive',
  platform: null,
  productId: null,
  originalTransactionId: null,
  transactionId: null,
  expiresAt: null,
  willAutoRenew: null,
  updatedAt: null,
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('browser auth coordinator fails closed without cross-tab Web Locks', async () => {
  let mutationRan = false
  const coordinator = createBrowserAuthCoordinator(
    () => undefined,
    () => true,
  )

  await expect(coordinator(async () => {
    mutationRan = true
  })).rejects.toMatchObject({ code: 'AUTH_BROWSER_LOCK_UNAVAILABLE' })
  expect(mutationRan).toBe(false)
})

test('AuthApi refreshes and retries authenticated requests with the new access token', async () => {
  const expiredAccessToken = accessTokenFor('user_1', 'expired')
  const freshAccessToken = accessTokenFor('user_1', 'fresh')
  let accessToken: string | null = expiredAccessToken
  const calls: Array<{ path: string; authorization: string | null }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const path = new URL(url).pathname
    const headers = new Headers(init?.headers)
    calls.push({ path, authorization: headers.get('Authorization') })

    const meCallCount = calls.filter((call) => call.path === '/api/auth/me').length

    if (path === '/api/auth/me' && meCallCount === 1) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
    }

    if (path === '/api/auth/refresh') {
      return json({
        accessToken: freshAccessToken,
      }, 200)
    }

    if (path === '/api/auth/me') {
      return json(
        {
          user: {
            id: 'user_1',
            email: 'user@example.com',
            displayName: null,
            role: 'user',
            createdAt: '2026-05-11T00:00:00.000Z',
            subscription: inactiveSubscription,
          },
        },
        200,
      )
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
  })

  const response = await client.me()
  const meCalls = calls.filter((call) => call.path === '/api/auth/me')

  expect(response.user.email).toBe('user@example.com')
  expect(meCalls).toHaveLength(2)
  expect(meCalls[0]?.authorization).toBe(`Bearer ${expiredAccessToken}`)
  expect(meCalls[1]?.authorization).toBe(`Bearer ${freshAccessToken}`)
})

test('AuthApi shares one refresh across concurrent unauthorized requests', async () => {
  const expiredAccessToken = accessTokenFor('user_1', 'expired')
  const freshAccessToken = accessTokenFor('user_1', 'fresh')
  let accessToken: string | null = expiredAccessToken
  const calls: Array<{ path: string; authorization: string | null; credentials: RequestCredentials | undefined }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const path = new URL(url).pathname
    const headers = new Headers(init?.headers)
    const authorization = headers.get('Authorization')
    calls.push({ path, authorization, credentials: init?.credentials })

    if (path === '/api/auth/refresh') {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return json({
        accessToken: freshAccessToken,
      }, 200)
    }

    if (path === '/api/auth/me' && authorization === `Bearer ${freshAccessToken}`) {
      return json(
        {
          user: {
            id: 'user_1',
            email: 'user@example.com',
            displayName: null,
            role: 'user',
            createdAt: '2026-05-11T00:00:00.000Z',
            subscription: inactiveSubscription,
          },
        },
        200,
      )
    }

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
  })

  const [first, second] = await Promise.all([client.me(), client.me()])
  const refreshCalls = calls.filter((call) => call.path === '/api/auth/refresh')
  const meCalls = calls.filter((call) => call.path === '/api/auth/me')

  expect(first.user.email).toBe('user@example.com')
  expect(second.user.email).toBe('user@example.com')
  expect(refreshCalls).toHaveLength(1)
  expect(meCalls).toHaveLength(4)
  expect(meCalls.filter((call) => call.authorization === `Bearer ${expiredAccessToken}`)).toHaveLength(2)
  expect(meCalls.filter((call) => call.authorization === `Bearer ${freshAccessToken}`)).toHaveLength(2)
  expect(calls.every((call) => call.credentials === 'include')).toBe(true)
})

test('AuthApi clears only local session state when refresh is unauthorized', async () => {
  let accessToken: string | null = 'expired-access-token'
  let authExpiredCalls = 0
  const calls: Array<{ path: string; authorization: string | null }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const path = new URL(url).pathname
    const headers = new Headers(init?.headers)
    calls.push({ path, authorization: headers.get('Authorization') })

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
    }

    if (path === '/api/auth/refresh') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } }, 401)
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      authExpiredCalls += 1
    },
  })

  await expect(client.me()).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHORIZED',
  })

  expect(accessToken).toBeNull()
  expect(authExpiredCalls).toBe(1)
  expect(calls.map((call) => call.path)).toEqual([
    '/api/auth/me',
    '/api/auth/refresh',
  ])
})

test('AuthApi preserves the session when refresh fails transiently', async () => {
  let accessToken: string | null = 'expired-access-token'
  let authExpiredCalls = 0

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
    }

    if (path === '/api/auth/refresh') {
      return json({ error: { code: 'UNAVAILABLE', message: 'Try again later' } }, 503)
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      authExpiredCalls += 1
    },
  })

  await expect(client.me()).rejects.toMatchObject({ status: 503 })
  expect(accessToken).toBe('expired-access-token')
  expect(authExpiredCalls).toBe(0)
})

test('AuthApi never refreshes an old request after another session epoch wins', async () => {
  let accessToken: string | null = 'account-a-access-token'
  let authExpiredCalls = 0
  const calls: string[] = []
  publishBrowserSessionState('authenticated')

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      authExpiredCalls += 1
    },
  })

  publishBrowserSessionState('authenticated')
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
  }

  await expect(client.me()).rejects.toMatchObject({ status: 401 })
  expect(calls).toEqual(['/api/auth/me'])
  expect(accessToken).toBe('account-a-access-token')
  expect(authExpiredCalls).toBe(0)
})

test('a late refresh 401 cannot clear a newer browser session epoch', async () => {
  let accessToken: string | null = 'account-a-access-token'
  let authExpiredCalls = 0
  let releaseRefresh!: () => void
  const refreshCanFinish = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const calls: string[] = []
  publishBrowserSessionState('authenticated')

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    if (path === '/api/auth/refresh') {
      await refreshCanFinish
      return json({ error: { code: 'UNAUTHORIZED', message: 'Old refresh failed' } }, 401)
    }
    return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      authExpiredCalls += 1
    },
  })
  const request = client.me()
  await waitForEvent(calls, '/api/auth/refresh')
  publishBrowserSessionState('authenticated')
  releaseRefresh()

  await expect(request).rejects.toMatchObject({ status: 401 })
  expect(accessToken).toBe('account-a-access-token')
  expect(authExpiredCalls).toBe(0)
})

test('AuthApi discards a successful response from an older browser session epoch', async () => {
  const accessToken = accessTokenFor('account-a', 'current')
  let releaseRequest!: () => void
  const requestCanFinish = new Promise<void>((resolve) => {
    releaseRequest = resolve
  })
  const calls: string[] = []
  publishBrowserSessionState('authenticated')

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    await requestCanFinish
    return json(
      {
        user: {
          id: 'account-a',
          email: 'account-a@example.com',
          displayName: null,
          role: 'user',
          createdAt: '2026-05-11T00:00:00.000Z',
          subscription: inactiveSubscription,
        },
      },
      200,
    )
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: () => undefined,
  })
  const request = client.me()
  await waitForEvent(calls, '/api/auth/me')
  publishBrowserSessionState('authenticated')
  releaseRequest()

  await expect(request).rejects.toThrow('Browser auth session changed')
})

test('AuthApi never retries an authenticated request as a different principal', async () => {
  const accountAAccessToken = accessTokenFor('account-a', 'expired')
  const accountBAccessToken = accessTokenFor('account-b', 'fresh')
  let accessToken: string | null = accountAAccessToken
  let authExpiredCalls = 0
  const calls: string[] = []
  publishBrowserSessionState('authenticated')

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    if (path === '/api/auth/refresh') {
      return json({
        accessToken: accountBAccessToken,
      }, 200)
    }
    return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      authExpiredCalls += 1
    },
  })

  await expect(client.me()).rejects.toMatchObject({ status: 401 })
  expect(calls).toEqual(['/api/auth/me', '/api/auth/refresh'])
  expect(accessToken).toBeNull()
  expect(authExpiredCalls).toBe(1)
})

test('AuthApi never retries an old request in another session of the same principal', async () => {
  const sessionAAccessToken = accessTokenFor('same-account', 'expired', 'session-a')
  const sessionBAccessToken = accessTokenFor('same-account', 'fresh', 'session-b')
  let accessToken: string | null = sessionAAccessToken
  let authExpiredCalls = 0
  const calls: string[] = []
  publishBrowserSessionState('authenticated')

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    if (path === '/api/auth/refresh') {
      return json({
        accessToken: sessionBAccessToken,
      }, 200)
    }
    return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      authExpiredCalls += 1
    },
  })

  await expect(client.me()).rejects.toMatchObject({ status: 401 })
  expect(calls).toEqual(['/api/auth/me', '/api/auth/refresh'])
  expect(accessToken).toBeNull()
  expect(authExpiredCalls).toBe(1)
})

test('AuthApi preserves backend error status, code, and message', async () => {
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname

    if (path === '/api/auth/register') {
      return json(
        {
          error: {
            code: 'CONFLICT',
            message: 'User with this email already exists',
          },
        },
        409,
      )
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new AuthApi({
    getAccessToken: () => null,
    setAccessToken: () => undefined,
  })

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
  const calls: Array<{ path: string; body: unknown }> = []
  let accessToken: string | null = 'existing-access-token'

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (path === '/api/auth/password-reset/request') {
      return json({ accepted: true }, 202)
    }
    if (path === '/api/auth/password-reset/confirm') {
      return new Response(null, { status: 204 })
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
  })

  await expect(
    client.requestPasswordReset({ email: ' USER@Example.COM ' }),
  ).resolves.toEqual({ accepted: true })
  await expect(
    client.confirmPasswordReset({
      token: 't'.repeat(43),
      password: 'new-password-123',
    }),
  ).resolves.toMatchObject({ data: undefined, sessionEpoch: expect.any(String) })
  expect(calls).toEqual([
    {
      path: '/api/auth/password-reset/request',
      body: { email: 'user@example.com' },
    },
    {
      path: '/api/auth/password-reset/confirm',
      body: { token: 't'.repeat(43), password: 'new-password-123' },
    },
  ])
  expect(accessToken).toBeNull()
})

test('AuthApi clearSession does not revoke a possibly newer shared browser cookie', async () => {
  let accessToken: string | null = 'stale-access-token'
  let authExpiredCalls = 0
  const calls: Array<{ path: string; method: string | undefined }> = []

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push({ path, method: init?.method })

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new AuthApi({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      authExpiredCalls += 1
    },
  })

  await client.clearSession()

  expect(accessToken).toBeNull()
  expect(authExpiredCalls).toBe(1)
  expect(calls).toEqual([])
})

test('bootstrapAuthSession clears local state only for an unauthorized refresh', async () => {
  const events: string[] = []
  let completed = false
  let finishCleanup!: () => void
  const cleanupFinished = new Promise<void>((resolve) => {
    finishCleanup = resolve
  })

  const bootstrap = bootstrapAuthSession({
    api: {
      refresh: async () => {
        events.push('refresh')
        throw new ApiRequestError(401, 'UNAUTHORIZED', 'Invalid refresh token')
      },
      clearSession: async () => {
        events.push('cleanup:start')
        await cleanupFinished
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

  await waitForEvent(events, 'cleanup:start')

  expect(completed).toBe(false)
  expect(events).toEqual(['refresh', 'cleanup:start'])

  finishCleanup()
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

async function waitForEvent(events: string[], event: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (events.includes(event)) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Timed out waiting for event: ${event}`)
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function accessTokenFor(subject: string, version: string, sessionId = 'session_1') {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject, sessionId, version })}.signature`
}
