import { expect, test } from 'bun:test';
import { z } from 'zod';

import { AuthApi } from '../src/features/auth/api';
import { ApiTransport } from '../src/platform/api/transport';
import { SessionController } from '../src/platform/session';

const refreshToken = 'r'.repeat(32);
const rotatedRefreshToken = 'n'.repeat(32);
const logoutIntentStorageNoop = {
  clearLogoutIntent: async () => undefined,
  getLogoutIntent: async () => false,
  setLogoutIntent: async () => undefined,
};

test('SessionController fences access and refresh credentials by session generation', async () => {
  let storedRefreshToken: string | null = refreshToken;
  const session = new SessionController({
    ...logoutIntentStorageNoop,
    clearRefreshToken: async () => {
      storedRefreshToken = null;
    },
    getRefreshToken: async () => storedRefreshToken,
    setRefreshToken: async (token) => {
      storedRefreshToken = token;
    },
  });

  const firstGeneration = session.getGeneration();
  session.setAccessToken('first-access-token', firstGeneration);
  const secondGeneration = session.beginTransition();

  expect(session.setAccessToken('stale-access-token', firstGeneration)).toBe(false);
  expect(session.getAccessToken()).toBe('first-access-token');
  await expect(session.setRefreshToken(rotatedRefreshToken, firstGeneration)).rejects.toMatchObject({
    code: 'AUTH_SESSION_CHANGED',
  });
  expect(storedRefreshToken).toBe(refreshToken);

  expect(session.setAccessToken('second-access-token', secondGeneration)).toBe(true);
  await session.setRefreshToken(rotatedRefreshToken, secondGeneration);
  expect(session.getAccessToken()).toBe('second-access-token');
  expect(storedRefreshToken).toBe(rotatedRefreshToken);
});

test('SessionController finalizes a durable logout by clearing refresh authority before its intent marker', async () => {
  const operations: string[] = [];
  const browserSessionEpoch = 17;
  let logoutIntentPending = false;
  let storedRefreshToken: string | null = refreshToken;
  const session = new SessionController({
    clearLogoutIntent: async (intentEpoch) => {
      expect(intentEpoch).toBe(browserSessionEpoch);
      expect(storedRefreshToken).toBeNull();
      operations.push('clear-intent');
      logoutIntentPending = false;
    },
    clearRefreshToken: async () => {
      expect(logoutIntentPending).toBe(true);
      operations.push('clear-refresh');
      storedRefreshToken = null;
    },
    getLogoutIntent: async () => logoutIntentPending,
    getRefreshToken: async () => storedRefreshToken,
    setLogoutIntent: async (intentEpoch) => {
      expect(intentEpoch).toBe(browserSessionEpoch);
      operations.push('mark-intent');
      logoutIntentPending = true;
    },
    setRefreshToken: async (token) => {
      storedRefreshToken = token;
    },
  });
  const generation = session.beginTransition();

  await session.markPendingLogout(generation, browserSessionEpoch);
  await session.completePendingLogout(generation, browserSessionEpoch);

  expect(operations).toEqual(['mark-intent', 'clear-refresh', 'clear-intent']);
  expect(await session.getPendingLogout()).toBe(false);
  expect(await session.getRefreshToken()).toBeNull();
});

test('SessionController retains the logout marker when refresh authority cleanup fails', async () => {
  let logoutIntentPending = false;
  let intentClearCalls = 0;
  const session = new SessionController({
    clearLogoutIntent: async () => {
      intentClearCalls += 1;
      logoutIntentPending = false;
    },
    clearRefreshToken: async () => {
      throw new Error('secure storage unavailable');
    },
    getLogoutIntent: async () => logoutIntentPending,
    getRefreshToken: async () => refreshToken,
    setLogoutIntent: async () => {
      logoutIntentPending = true;
    },
    setRefreshToken: async () => undefined,
  });
  const generation = session.beginTransition();

  await session.markPendingLogout(generation);
  await expect(session.completePendingLogout(generation))
    .rejects.toThrow('secure storage unavailable');

  expect(logoutIntentPending).toBe(true);
  expect(intentClearCalls).toBe(0);
});

test('authenticated transport never persists or replays a refresh from an old session generation', async () => {
  let storedRefreshToken: string | null = refreshToken;
  let resolveRefresh: ((response: Response) => void) | null = null;
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  try {
    const session = new SessionController({
      ...logoutIntentStorageNoop,
      clearRefreshToken: async () => {
        storedRefreshToken = null;
      },
      getRefreshToken: async () => storedRefreshToken,
      setRefreshToken: async (token) => {
        storedRefreshToken = token;
      },
    });
    session.setAccessToken('expired-access-token', session.getGeneration());

    globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === '/api/auth/me') {
        return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
      }
      if (path === '/api/auth/token/refresh') {
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }
      return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
    };

    let auth!: AuthApi;
    const transport = new ApiTransport({
      expire: session.expire,
      getAccessToken: session.getAccessToken,
      getGeneration: session.getGeneration,
      isGenerationCurrent: session.isGenerationCurrent,
      refresh: (generation) => auth.refresh(generation),
      setAccessToken: session.setAccessToken,
    });
    auth = new AuthApi(transport, {
      clearRefreshToken: session.clearRefreshToken,
      getAccessToken: session.getAccessToken,
      getGeneration: session.getGeneration,
      getRefreshToken: session.getRefreshToken,
      isGenerationCurrent: session.isGenerationCurrent,
      setRefreshToken: session.setRefreshToken,
    }, 'token');
    const request = auth.me();
    await waitUntil(() => resolveRefresh !== null);

    session.beginTransition();
    resolveRefresh?.(json({
      accessToken: 'stale-access-token',
      refreshToken: rotatedRefreshToken,
    }, 200));

    await expect(request).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
    expect(storedRefreshToken).toBe(refreshToken);
    expect(calls).toEqual(['/api/auth/me', '/api/auth/token/refresh']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authenticated transport rejects a successful response from an old session generation', async () => {
  let resolveRequest: ((response: Response) => void) | null = null;
  const originalFetch = globalThis.fetch;

  try {
    const session = new SessionController({
      ...logoutIntentStorageNoop,
      clearRefreshToken: async () => undefined,
      getRefreshToken: async () => refreshToken,
      setRefreshToken: async () => undefined,
    });
    session.setAccessToken('first-access-token', session.getGeneration());
    globalThis.fetch = async () =>
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      });

    const transport = new ApiTransport({
      expire: session.expire,
      getAccessToken: session.getAccessToken,
      getGeneration: session.getGeneration,
      isGenerationCurrent: session.isGenerationCurrent,
      refresh: async () => ({ accessToken: 'unused-access-token' }),
      setAccessToken: session.setAccessToken,
    });
    const request = transport.raw('/api/protected', { auth: true });
    await waitUntil(() => resolveRequest !== null);

    session.beginTransition();
    resolveRequest?.(json({ ok: true }, 200));

    await expect(request).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authenticated transport fences session changes while parsing success and error bodies', async () => {
  for (const status of [200, 401]) {
    let resolveBody: ((body: unknown) => void) | null = null;
    const originalFetch = globalThis.fetch;
    try {
      const session = new SessionController({
        ...logoutIntentStorageNoop,
        clearRefreshToken: async () => undefined,
        getRefreshToken: async () => refreshToken,
        setRefreshToken: async () => undefined,
      });
      session.setAccessToken('first-access-token', session.getGeneration());
      globalThis.fetch = async () => ({
        ok: status === 200,
        status,
        json: () => new Promise((resolve) => {
          resolveBody = resolve;
        }),
      }) as Response;

      const transport = new ApiTransport({
        expire: session.expire,
        getAccessToken: session.getAccessToken,
        getGeneration: session.getGeneration,
        isGenerationCurrent: session.isGenerationCurrent,
        refresh: async () => ({ accessToken: 'unused-access-token' }),
        setAccessToken: session.setAccessToken,
      });
      const request = transport.request('/api/protected', z.object({ ok: z.boolean() }), {
        auth: true,
        retryOnUnauthorized: false,
      });
      await waitUntil(() => resolveBody !== null);

      session.beginTransition();
      resolveBody?.(
        status === 200
          ? { ok: true }
          : { error: { code: 'UNAUTHORIZED', message: 'Old session' } },
      );

      await expect(request).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for test condition');
}
