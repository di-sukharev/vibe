import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UserDto } from '@web-app-demo/contracts'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { AuthContextValue } from '../src/features/auth/context'
import { AuthProvider } from '../src/features/auth/provider'
import { useAuth } from '../src/features/auth/use-auth'

type SessionSnapshot = Pick<AuthContextValue, 'isBootstrapping' | 'sessionError' | 'user'>

const user: UserDto = {
  id: 'user_1',
  email: 'user@example.com',
  displayName: null,
  role: 'user',
  createdAt: '2026-05-11T00:00:00.000Z',
}
const restoredAccessToken = accessTokenFor('user_1')

const originalFetch = globalThis.fetch
const mountedRoots: Root[] = []

beforeEach(() => {
  installBrowserShim()
})

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount())
  }
  globalThis.fetch = originalFetch
  removeBrowserShim()
})

test('the session stays unknown while the restored access token is still being verified', async () => {
  const me = deferred<Response>()
  const requests = installFakeBackend({
    refresh: () => json({ accessToken: restoredAccessToken }, 200),
    me: () => me.promise,
  })
  const { session, snapshots } = await mountAuthProvider()
  await flushUntil(() => requests.includes('GET /api/auth/me'))

  expect(requests).toContain('GET /api/auth/me')
  expect(session()).toEqual({ isBootstrapping: true, sessionError: null, user: null })

  me.resolve(json({ user }, 200))
  await flushUntil(() => session().user !== null)

  expect(session()).toEqual({ isBootstrapping: false, sessionError: null, user })
  const signedOutRenders = snapshots.filter(
    (snapshot) => !snapshot.isBootstrapping && !snapshot.sessionError && !snapshot.user,
  )
  expect(signedOutRenders).toEqual([])
})

test('a browser without a session cookie resolves to signed out without loading /me', async () => {
  const requests = installFakeBackend({
    refresh: () => json({ error: { code: 'UNAUTHORIZED', message: 'No session' } }, 401),
    me: () => json({ user }, 200),
  })
  const { session } = await mountAuthProvider()
  await flushUntil(() => !session().isBootstrapping)

  expect(session()).toEqual({ isBootstrapping: false, sessionError: null, user: null })
  expect(requests).not.toContain('GET /api/auth/me')
})

test('a failed session restore surfaces the error instead of an unknown session', async () => {
  const requests = installFakeBackend({
    refresh: () => json({ error: { code: 'INTERNAL_ERROR', message: 'Refresh failed' } }, 500),
    me: () => json({ user }, 200),
  })
  const { session } = await mountAuthProvider()
  await flushUntil(() => !session().isBootstrapping)

  expect(session().isBootstrapping).toBe(false)
  expect(session().user).toBeNull()
  expect(session().sessionError?.message).toBe('Refresh failed')
  expect(requests).not.toContain('GET /api/auth/me')
})

async function mountAuthProvider() {
  const snapshots: SessionSnapshot[] = []
  function SessionProbe() {
    const auth = useAuth()
    snapshots.push({
      isBootstrapping: auth.isBootstrapping,
      sessionError: auth.sessionError,
      user: auth.user,
    })
    return null
  }

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRoot(createDetachedContainer())
  mountedRoots.push(root)

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AuthProvider, null, createElement(SessionProbe)),
      ),
    )
  })

  return {
    snapshots,
    session: () => {
      const latest = snapshots[snapshots.length - 1]
      if (!latest) throw new Error('AuthProvider has not rendered its consumer yet')
      return latest
    },
  }
}

// TanStack Query delivers query results to React on a zero-delay timer, so the tests advance in
// act-wrapped timer ticks until the observed state arrives instead of guessing a fixed delay.
async function flushUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  }
}

function installFakeBackend(backend: {
  refresh: () => Response | Promise<Response>
  me: () => Response | Promise<Response>
}) {
  const requests: string[] = []
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    requests.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === '/api/auth/refresh') return backend.refresh()
    if (path === '/api/auth/me') return backend.me()
    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }
  return requests
}

// The repository has no DOM library and the provider renders no host elements, so a plain object
// with the members React DOM touches for a root container (event delegation and focus lookup) is
// enough to run the provider's effects under `act`.
const browserShim = {
  event: undefined,
  document: { activeElement: null, body: null },
  HTMLIFrameElement: class {},
  addEventListener() {},
  removeEventListener() {},
}
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; window?: unknown }

function installBrowserShim() {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  actEnvironment.window = browserShim
}

function removeBrowserShim() {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  delete actEnvironment.window
}

function createDetachedContainer() {
  const ownerDocument = {
    nodeType: 9,
    defaultView: browserShim,
    addEventListener() {},
    removeEventListener() {},
  }
  return {
    nodeType: 1,
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Element
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function accessTokenFor(subject: string) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject })}.signature`
}
