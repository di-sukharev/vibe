import { afterEach, expect, test } from 'bun:test';

import { AuthApi } from '../src/features/auth/api';
import {
  clearPendingBrowserLogout,
  getPendingBrowserLogout,
  markPendingBrowserLogout,
} from '../src/features/auth/browser-logout-intent';
import {
  createBrowserAuthCoordinator,
  type BrowserAuthCoordinator,
} from '../src/features/auth/browser-auth-coordinator';
import { browserSessionCoordinator } from '../src/features/auth/browser-session-coordinator';
import { logoutWithPushCleanup } from '../src/features/auth/logout';
import { ApiTransport } from '../src/platform/api/transport';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('cookie auth serializes concurrent logins so the newest generation owns the browser cookie', async () => {
  const state = createSessionState();
  const events: string[] = [];
  let browserCookiePrincipal: string | null = null;
  let releaseAccountALogin!: () => void;
  const accountALoginCanFinish = new Promise<void>((resolve) => {
    releaseAccountALogin = resolve;
  });

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { email: string };
    const principal = body.email.startsWith('account-a') ? 'account-a' : 'account-b';
    events.push(`${principal}:fetch`);
    if (principal === 'account-a') await accountALoginCanFinish;
    browserCookiePrincipal = principal;
    events.push(`${principal}:cookie`);
    return json(authResponse(principal), 200);
  };

  const auth = createAuthApi('cookie', state);
  const accountALogin = auth.login(
    { email: 'account-a@example.com', password: 'password123' },
    state.generation,
  );
  await waitForEvent(events, 'account-a:fetch');

  state.generation += 1;
  const accountBLogin = auth.login(
    { email: 'account-b@example.com', password: 'password123' },
    state.generation,
  );
  await nextTask();
  releaseAccountALogin();

  const [accountAResult, accountBResult] = await Promise.allSettled([
    accountALogin,
    accountBLogin,
  ]);

  expect(accountAResult.status).toBe('rejected');
  expect(accountBResult.status).toBe('fulfilled');
  expect(events).toEqual([
    'account-a:fetch',
    'account-a:cookie',
    'account-b:fetch',
    'account-b:cookie',
  ]);
  expect(browserCookiePrincipal).toBe('account-b');
});

test('cookie auth rejects a delayed old logout before it can clear a newer login cookie', async () => {
  const state = createSessionState();
  const calls: string[] = [];
  let browserCookiePrincipal: string | null = null;

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/api/auth/login') {
      browserCookiePrincipal = 'account-b';
      return json(authResponse('account-b'), 200);
    }
    if (path === '/api/auth/logout') {
      browserCookiePrincipal = null;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${path} ${init?.method}`);
  };

  const auth = createAuthApi('cookie', state);
  const oldLogoutGeneration = state.generation;
  state.generation += 1;
  await auth.login(
    { email: 'account-b@example.com', password: 'password123' },
    state.generation,
  );

  await expect(auth.logout({}, oldLogoutGeneration)).rejects.toMatchObject({
    code: 'AUTH_SESSION_CHANGED',
  });
  expect(calls).toEqual(['/api/auth/login']);
  expect(browserCookiePrincipal).toBe('account-b');
});

test('cookie logout fences its browser epoch before local cleanup can yield to another tab login', async () => {
  const accountAState = createSessionState();
  const accountBState = createSessionState();
  const browserAuthCoordinator = createTestBrowserAuthCoordinator();
  const browserSessionCoordinator = createTestBrowserSessionCoordinator();
  const durableLogoutStorage = createBrowserStorage();
  const calls: string[] = [];
  let browserCookiePrincipal: string | null = 'account-a';
  let markCleanupStarted!: () => void;
  const cleanupStarted = new Promise<void>((resolve) => {
    markCleanupStarted = resolve;
  });
  let releaseCleanup!: () => void;
  const cleanupCanFinish = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/api/auth/login') {
      browserCookiePrincipal = 'account-b';
      return json(authResponse('account-b'), 200);
    }
    if (path === '/api/auth/logout') {
      browserCookiePrincipal = null;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const accountAAuth = createAuthApi(
    'cookie',
    accountAState,
    browserAuthCoordinator,
    browserSessionCoordinator,
  );
  const accountBAuth = createAuthApi(
    'cookie',
    accountBState,
    browserAuthCoordinator,
    browserSessionCoordinator,
  );
  const staleLogout = logoutWithPushCleanup({
    authApi: accountAAuth,
    clearLocalSession: async () => undefined,
    clearPendingExpoPushTokenCleanup: async () => undefined,
    clearStoredExpoPushToken: async () => undefined,
    completePendingLogout: async (browserSessionEpoch) => {
      clearPendingBrowserLogout(durableLogoutStorage, browserSessionEpoch);
    },
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [],
    getStoredExpoPushToken: async () => null,
    getStoredRefreshToken: async () => null,
    markPendingLogout: async (browserSessionEpoch) => {
      expect(browserSessionEpoch).toBe(0);
      markPendingBrowserLogout(durableLogoutStorage, browserSessionEpoch as number);
      markCleanupStarted();
      await cleanupCanFinish;
    },
    sessionGeneration: accountAState.generation,
    setPendingExpoPushTokenCleanup: async () => undefined,
  });
  await cleanupStarted;

  await accountBAuth.login(
    { email: 'account-b@example.com', password: 'password123' },
    accountBState.generation,
  );
  releaseCleanup();

  await expect(staleLogout).resolves.toEqual({
    sessionRevoked: false,
    status: 'retryable',
  });
  expect(calls).toEqual(['/api/auth/login']);
  expect(browserCookiePrincipal).toBe('account-b');
  expect(
    getPendingBrowserLogout(
      durableLogoutStorage,
      browserSessionCoordinator.current().epoch,
    ),
  ).toBe(false);
});

test('cookie auth rejects a delayed old refresh before it can rotate a newer login cookie', async () => {
  const state = createSessionState();
  const calls: string[] = [];
  let browserCookiePrincipal: string | null = null;

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/api/auth/login') {
      browserCookiePrincipal = 'account-b';
      return json(authResponse('account-b'), 200);
    }
    if (path === '/api/auth/refresh') {
      browserCookiePrincipal = 'account-a';
      return json({ accessToken: 'account-a-refreshed-access-token' }, 200);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const auth = createAuthApi('cookie', state);
  const oldRefreshGeneration = state.generation;
  state.generation += 1;
  await auth.login(
    { email: 'account-b@example.com', password: 'password123' },
    state.generation,
  );

  await expect(auth.refresh(oldRefreshGeneration)).rejects.toMatchObject({
    code: 'AUTH_SESSION_CHANGED',
  });
  expect(calls).toEqual(['/api/auth/login']);
  expect(browserCookiePrincipal).toBe('account-b');
});

test('cookie auth releases its in-process coordinator after response parsing fails', async () => {
  const state = createSessionState();
  const events: string[] = [];
  let releaseRegisterError!: () => void;
  const registerErrorCanFinish = new Promise<void>((resolve) => {
    releaseRegisterError = resolve;
  });

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/auth/register') {
      events.push('register:fetch');
      return {
        ok: false,
        status: 503,
        json: async () => {
          await registerErrorCanFinish;
          events.push('register:error');
          return { error: { code: 'INTERNAL_ERROR', message: 'Temporarily unavailable' } };
        },
      } as Response;
    }
    if (path === '/api/auth/login') {
      events.push('login:fetch');
      return json(authResponse('account-b'), 200);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const auth = createAuthApi('cookie', state);
  const register = auth.register(
    { email: 'account-a@example.com', password: 'password123' },
    state.generation,
  );
  await waitForEvent(events, 'register:fetch');
  const login = auth.login(
    { email: 'account-b@example.com', password: 'password123' },
    state.generation,
  );
  await nextTask();
  releaseRegisterError();

  await expect(register).rejects.toMatchObject({ status: 503 });
  await expect(login).resolves.toMatchObject({
    user: { id: 'account-b' },
  });
  expect(events).toEqual(['register:fetch', 'register:error', 'login:fetch']);
});

test('authenticated cookie requests can enter the coordinator only for their nested refresh', async () => {
  const state = createSessionState();
  const expiredAccessToken = accessTokenFor('account-a', 'session-a', 'expired');
  const freshAccessToken = accessTokenFor('account-a', 'session-a', 'fresh');
  state.accessToken = expiredAccessToken;
  const calls: string[] = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path === '/api/auth/me' && authorization === `Bearer ${freshAccessToken}`) {
      return json({ user: authResponse('account-a').user }, 200);
    }
    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }
    if (path === '/api/auth/refresh') {
      return json(refreshResponse('account-a', 'session-a', 'fresh'), 200);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const auth = createAuthApi('cookie', state);
  const result = await Promise.race([
    auth.me(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Cookie refresh coordinator deadlocked')), 250);
    }),
  ]);

  expect(result.user.id).toBe('account-a');
  expect(state.accessToken).toBe(freshAccessToken);
  expect(calls).toEqual(['/api/auth/me', '/api/auth/refresh', '/api/auth/me']);
});

test('browser auth coordinator uses one named exclusive Web Lock when available', async () => {
  const events: string[] = [];
  const coordinator = createBrowserAuthCoordinator(() => ({
    request: async (name, options, mutation) => {
      events.push(`lock:${name}:${options.mode}`);
      const result = await mutation();
      events.push('lock:released');
      return result;
    },
  }));

  await expect(coordinator(async () => {
    events.push('mutation');
    return 'done';
  })).resolves.toBe('done');

  expect(events).toEqual([
    'lock:web_app_demo:auth-cookie-mutation:exclusive',
    'mutation',
    'lock:released',
  ]);
});

test('browser auth coordinator fails closed in a browser without Web Locks', async () => {
  let mutationRan = false;
  const coordinator = createBrowserAuthCoordinator(
    () => undefined,
    () => true,
  );

  await expect(coordinator(async () => {
    mutationRan = true;
  })).rejects.toMatchObject({ code: 'AUTH_BROWSER_LOCK_UNAVAILABLE' });
  expect(mutationRan).toBe(false);
});

test('browser session coordinator accepts remote events and advances its monotonic epoch', async () => {
  if (typeof BroadcastChannel === 'undefined') return;

  const remoteChannel = new BroadcastChannel('web_app_demo:expo-web-auth-session');
  const remoteEpoch = browserSessionCoordinator.current().epoch + 1_000_000;
  const received = new Promise<{ epoch: number; state: string; userId?: string }>((resolve) => {
    const unsubscribe = browserSessionCoordinator.subscribe((event) => {
      if (event.epoch !== remoteEpoch) return;
      unsubscribe();
      resolve(event);
    });
  });

  remoteChannel.postMessage({
    epoch: remoteEpoch,
    sourceId: 'remote-tab',
    state: 'authenticated',
    userId: 'account-b',
  });

  await expect(Promise.race([
    received,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Remote browser session event was not delivered')), 100);
    }),
  ])).resolves.toEqual({
    epoch: remoteEpoch,
    state: 'authenticated',
    userId: 'account-b',
  });
  remoteChannel.close();

  const published = browserSessionCoordinator.publish('cleared');
  expect(published).toEqual({
    epoch: remoteEpoch + 1,
    state: 'cleared',
  });
});

test('native token auth never enters the browser cookie coordinator', async () => {
  const state = createSessionState();
  let coordinatorCalls = 0;
  const calls: string[] = [];
  const coordinator: BrowserAuthCoordinator = async (mutation) => {
    coordinatorCalls += 1;
    return mutation();
  };

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/api/auth/token/logout') {
      return new Response(null, {
        status: 204,
        headers: { 'X-Auth-Session-Revoked': 'true' },
      });
    }
    if (path === '/api/auth/token/refresh') {
      return json({
        accessToken: 'refreshed-access-token',
        refreshToken: 'n'.repeat(32),
      }, 200);
    }
    return json({
      ...authResponse('account-a'),
      refreshToken: 'n'.repeat(32),
    }, 200);
  };

  const auth = createAuthApi('token', state, coordinator);
  await auth.register({ email: 'account-a@example.com', password: 'password123' });
  await auth.login({ email: 'account-a@example.com', password: 'password123' });
  await auth.socialAuth('google', { idToken: 'google-id-token' });
  await auth.refresh();
  await auth.logout();

  expect(coordinatorCalls).toBe(0);
  expect(calls).toEqual([
    '/api/auth/token/register',
    '/api/auth/token/login',
    '/api/auth/token/social/google',
    '/api/auth/token/refresh',
    '/api/auth/token/logout',
  ]);
});

test('a tab refresh queued behind another tab login is rejected before its cookie fetch', async () => {
  const sharedBrowserSession = createTestBrowserSessionCoordinator();
  const browserAuthCoordinator = createTestBrowserAuthCoordinator();
  const accountAState = createSessionState();
  const accountBState = createSessionState();
  accountAState.accessToken = accessTokenFor('account-a', 'session-a');
  const calls: string[] = [];
  let accountAExpired = 0;
  let releaseAccountBLogin!: () => void;
  const accountBLoginCanFinish = new Promise<void>((resolve) => {
    releaseAccountBLogin = resolve;
  });

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/api/auth/login') {
      await accountBLoginCanFinish;
      return json(authResponse('account-b'), 200);
    }
    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }
    if (path === '/api/auth/refresh') {
      return json(refreshResponse('account-a', 'session-a'), 200);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const accountAAuth = createAuthApi(
    'cookie',
    accountAState,
    browserAuthCoordinator,
    sharedBrowserSession,
    () => {
      accountAExpired += 1;
    },
  );
  const accountBAuth = createAuthApi(
    'cookie',
    accountBState,
    browserAuthCoordinator,
    sharedBrowserSession,
  );

  const accountBLogin = accountBAuth.login({
    email: 'account-b@example.com',
    password: 'password123',
  });
  await waitForEvent(calls, '/api/auth/login');
  const oldAccountRequest = accountAAuth.me().catch((error: unknown) => error);
  await waitForEvent(calls, '/api/auth/me');
  releaseAccountBLogin();

  await expect(accountBLogin).resolves.toMatchObject({ user: { id: 'account-b' } });
  await expect(oldAccountRequest).resolves.toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
  expect(accountAExpired).toBe(1);
  expect(calls).toEqual(['/api/auth/login', '/api/auth/me']);
});

test('refresh identity prevents an old tab retry under a new cookie principal without epoch delivery', async () => {
  const browserAuthCoordinator = createTestBrowserAuthCoordinator();
  const accountAState = createSessionState();
  const accountBState = createSessionState();
  accountAState.accessToken = accessTokenFor('account-a', 'session-a');
  let browserCookiePrincipal = 'account-a';
  let accountAExpired = 0;
  const calls: Array<{ authorization: string | null; path: string }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const authorization = new Headers(init?.headers).get('Authorization');
    calls.push({ authorization, path });
    if (path === '/api/auth/login') {
      browserCookiePrincipal = 'account-b';
      return json(authResponse('account-b'), 200);
    }
    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }
    if (path === '/api/auth/refresh' && browserCookiePrincipal === 'account-b') {
      return json(refreshResponse('account-b', 'session-b'), 200);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const accountAAuth = createAuthApi(
    'cookie',
    accountAState,
    browserAuthCoordinator,
    createTestBrowserSessionCoordinator(),
    () => {
      accountAExpired += 1;
    },
  );
  const accountBAuth = createAuthApi(
    'cookie',
    accountBState,
    browserAuthCoordinator,
    createTestBrowserSessionCoordinator(),
  );

  await accountBAuth.login({
    email: 'account-b@example.com',
    password: 'password123',
  });
  await expect(accountAAuth.me()).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' });

  expect(accountAExpired).toBe(1);
  expect(accountAState.accessToken).toBe(accessTokenFor('account-a', 'session-a'));
  expect(calls).toEqual([
    { authorization: null, path: '/api/auth/login' },
    {
      authorization: `Bearer ${accessTokenFor('account-a', 'session-a')}`,
      path: '/api/auth/me',
    },
    { authorization: null, path: '/api/auth/refresh' },
  ]);
});

test('bounded cookie logout aborts its fetch and releases the next browser auth mutation', async () => {
  const state = createSessionState();
  const browserAuthCoordinator = createTestBrowserAuthCoordinator();
  const browserSessionCoordinator = createTestBrowserSessionCoordinator();
  const events: string[] = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/auth/logout') {
      events.push('logout:fetch');
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          events.push('logout:aborted');
          reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
    if (path === '/api/auth/login') {
      events.push('login:fetch');
      return json(authResponse('account-b'), 200);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const auth = createAuthApi(
    'cookie',
    state,
    browserAuthCoordinator,
    browserSessionCoordinator,
  );
  await expect(logoutWithPushCleanup({
    authApi: auth,
    clearLocalSession: async () => undefined,
    clearPendingExpoPushTokenCleanup: async () => undefined,
    clearStoredExpoPushToken: async () => undefined,
    completePendingLogout: async () => undefined,
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [],
    getStoredExpoPushToken: async () => null,
    getStoredRefreshToken: async () => null,
    markPendingLogout: async () => undefined,
    sessionGeneration: state.generation,
    serverLogoutTimeoutMs: 5,
    setPendingExpoPushTokenCleanup: async () => undefined,
  })).resolves.toEqual({ sessionRevoked: false, status: 'retryable' });

  state.generation += 1;
  const nextLogin = auth.login(
    { email: 'account-b@example.com', password: 'password123' },
    state.generation,
  );
  await expect(Promise.race([
    nextLogin,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Cookie logout kept the auth lock')), 100);
    }),
  ])).resolves.toMatchObject({ user: { id: 'account-b' } });
  expect(events).toEqual(['logout:fetch', 'logout:aborted', 'login:fetch']);
});

function createSessionState() {
  return {
    accessToken: null as string | null,
    generation: 0,
    refreshToken: 'r'.repeat(32) as string | null,
  };
}

function createBrowserStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function createAuthApi(
  kind: 'cookie' | 'token',
  state: ReturnType<typeof createSessionState>,
  browserAuthCoordinator?: BrowserAuthCoordinator,
  browserSessionCoordinator?: TestBrowserSessionCoordinator,
  onExpire: () => void | Promise<void> = () => undefined,
) {
  let auth!: AuthApi;
  const transport = new ApiTransport(
    {
      expire: async () => onExpire(),
      getAccessToken: () => state.accessToken,
      getGeneration: () => state.generation,
      isGenerationCurrent: (generation) => generation === state.generation,
      refresh: (generation) => auth.refresh(generation),
      setAccessToken: (accessToken, generation) => {
        if (generation !== state.generation) return false;
        state.accessToken = accessToken;
        return true;
      },
    },
    'http://localhost:3000',
    kind === 'cookie' ? 'include' : undefined,
  );
  auth = new AuthApi(
    transport,
    {
      browserAuthCoordinator: browserAuthCoordinator
        ?? (kind === 'cookie' ? createTestBrowserAuthCoordinator() : undefined),
      browserSessionCoordinator,
      clearRefreshToken: async () => {
        state.refreshToken = null;
      },
      getAccessToken: () => state.accessToken,
      getGeneration: () => state.generation,
      getRefreshToken: async () => state.refreshToken,
      isGenerationCurrent: (generation) => generation === state.generation,
      setRefreshToken: async (refreshToken) => {
        state.refreshToken = refreshToken;
      },
    },
    kind,
  );
  return auth;
}

type TestBrowserSessionEvent = {
  epoch: number;
  state: 'authenticated' | 'cleared';
  userId?: string;
};

type TestBrowserSessionCoordinator = {
  current: () => TestBrowserSessionEvent;
  isCurrent: (epoch: number) => boolean;
  publish: (
    state: TestBrowserSessionEvent['state'],
    userId?: string,
  ) => TestBrowserSessionEvent;
  subscribe: (listener: (event: TestBrowserSessionEvent) => void) => () => void;
};

function createTestBrowserSessionCoordinator(): TestBrowserSessionCoordinator {
  let event: TestBrowserSessionEvent = { epoch: 0, state: 'cleared' };
  const listeners = new Set<(event: TestBrowserSessionEvent) => void>();
  return {
    current: () => event,
    isCurrent: (epoch) => epoch === event.epoch,
    publish: (state, userId) => {
      event = {
        epoch: event.epoch + 1,
        state,
        ...(userId ? { userId } : {}),
      };
      return event;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createTestBrowserAuthCoordinator() {
  return createBrowserAuthCoordinator(
    () => undefined,
    () => false,
  );
}

function authResponse(principal: string) {
  return {
    accessToken: `${principal}-access-token`,
    user: {
      id: principal,
      email: `${principal}@example.com`,
      displayName: null,
      role: 'user',
      createdAt: '2026-05-11T00:00:00.000Z',
    },
  };
}

function refreshResponse(userId: string, sessionId: string, version = 'current') {
  return {
    accessToken: accessTokenFor(userId, sessionId, version),
  };
}

function accessTokenFor(userId: string, sessionId: string, version = 'current') {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: userId,
    sessionId,
    version,
  })}.signature`;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function waitForEvent(events: string[], event: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (events.includes(event)) return;
    await nextTask();
  }
  throw new Error(`Timed out waiting for event: ${event}`);
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
