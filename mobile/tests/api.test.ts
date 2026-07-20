import { afterEach, expect, test } from 'bun:test';

import { AuthApi } from '../src/features/auth/api';
import { createBrowserAuthCoordinator } from '../src/features/auth/browser-auth-coordinator';
import { BillingApi } from '../src/features/billing/api';
import { NotificationsApi } from '../src/features/notifications/api';
import { ApiTransport } from '../src/platform/api';
import { authTransportForPlatform } from '../src/composition/auth-transport';

const originalFetch = globalThis.fetch;
const refreshToken = 'r'.repeat(32);
const rotatedRefreshToken = 'n'.repeat(32);
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
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('mobile auth API refreshes through the shared transport and retries authenticated requests', async () => {
  let accessToken: string | null = 'expired-access-token';
  let storedRefreshToken: string | null = refreshToken;
  const calls: Array<{ path: string; authorization: string | null; body: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, authorization: headers.get('Authorization'), body });

    if (path === '/api/auth/me' && headers.get('Authorization') === 'Bearer fresh-access-token') {
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
      );
    }

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }

    if (path === '/api/auth/token/refresh') {
      return json({
        accessToken: 'fresh-access-token',
        refreshToken: rotatedRefreshToken,
      }, 200);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { auth: client } = createTestApis({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken;
    },
    getRefreshToken: async () => storedRefreshToken,
    setRefreshToken: async (nextRefreshToken) => {
      storedRefreshToken = nextRefreshToken;
    },
    clearRefreshToken: async () => {
      storedRefreshToken = null;
    },
  });

  const response = await client.me();

  expect(response.user.email).toBe('user@example.com');
  expect(accessToken).toBe('fresh-access-token');
  expect(storedRefreshToken).toBe(rotatedRefreshToken);
  expect(calls.map((call) => call.path)).toEqual([
    '/api/auth/me',
    '/api/auth/token/refresh',
    '/api/auth/me',
  ]);
  expect(calls[0]?.authorization).toBe('Bearer expired-access-token');
  expect(calls[1]?.body).toEqual({ refreshToken });
  expect(calls[2]?.authorization).toBe('Bearer fresh-access-token');
});

test('mobile feature APIs share one refresh request across concurrent 401 responses', async () => {
  let accessToken: string | null = 'expired-access-token';
  let storedRefreshToken: string | null = refreshToken;
  const calls: Array<{ path: string; authorization: string | null }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    const authorization = headers.get('Authorization');
    calls.push({ path, authorization });

    if (path === '/api/auth/token/refresh') {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return json({
        accessToken: 'fresh-access-token',
        refreshToken: rotatedRefreshToken,
      }, 200);
    }

    if (path === '/api/auth/me' && authorization === 'Bearer fresh-access-token') {
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
      );
    }

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { auth: client } = createTestApis({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken;
    },
    getRefreshToken: async () => storedRefreshToken,
    setRefreshToken: async (nextRefreshToken) => {
      storedRefreshToken = nextRefreshToken;
    },
    clearRefreshToken: async () => {
      storedRefreshToken = null;
    },
  });

  const [first, second] = await Promise.all([client.me(), client.me()]);
  const refreshCalls = calls.filter((call) => call.path === '/api/auth/token/refresh');
  const meCalls = calls.filter((call) => call.path === '/api/auth/me');

  expect(first.user.email).toBe('user@example.com');
  expect(second.user.email).toBe('user@example.com');
  expect(refreshCalls).toHaveLength(1);
  expect(meCalls).toHaveLength(4);
});

test('mobile API transport clears token state when refresh fails', async () => {
  let accessToken: string | null = 'expired-access-token';
  let storedRefreshToken: string | null = refreshToken;
  let clearRefreshTokenCalls = 0;
  let authExpiredCalls = 0;
  let accessTokenAtAuthExpired: string | null = null;
  let refreshTokenAtAuthExpired: string | null = null;

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }

    if (path === '/api/auth/token/refresh') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } }, 401);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { auth: client } = createTestApis({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken;
    },
    getRefreshToken: async () => storedRefreshToken,
    setRefreshToken: async (nextRefreshToken) => {
      storedRefreshToken = nextRefreshToken;
    },
    clearRefreshToken: async () => {
      clearRefreshTokenCalls += 1;
      storedRefreshToken = null;
    },
    onAuthExpired: () => {
      authExpiredCalls += 1;
      accessTokenAtAuthExpired = accessToken;
      refreshTokenAtAuthExpired = storedRefreshToken;
    },
  });

  await expect(client.me()).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHORIZED',
  });

  expect(accessToken).toBeNull();
  expect(storedRefreshToken).toBeNull();
  expect(clearRefreshTokenCalls).toBe(1);
  expect(authExpiredCalls).toBe(1);
  expect(accessTokenAtAuthExpired).toBe('expired-access-token');
  expect(refreshTokenAtAuthExpired).toBe(refreshToken);
});

test('mobile API transport expires the session when the retried request stays unauthorized', async () => {
  let accessToken: string | null = 'expired-access-token';
  let storedRefreshToken: string | null = refreshToken;
  let authExpiredCalls = 0;
  const paths: string[] = [];

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Session was revoked' } }, 401);
    }

    if (path === '/api/auth/token/refresh') {
      return json({
        accessToken: 'fresh-access-token',
        refreshToken: rotatedRefreshToken,
      }, 200);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { auth: client } = createTestApis({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken;
    },
    getRefreshToken: async () => storedRefreshToken,
    setRefreshToken: async (nextRefreshToken) => {
      storedRefreshToken = nextRefreshToken;
    },
    clearRefreshToken: async () => {
      storedRefreshToken = null;
    },
    onAuthExpired: () => {
      authExpiredCalls += 1;
    },
  });

  await expect(client.me()).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });

  expect(paths).toEqual(['/api/auth/me', '/api/auth/token/refresh', '/api/auth/me']);
  expect(authExpiredCalls).toBe(1);
  expect(accessToken).toBeNull();
  expect(storedRefreshToken).toBeNull();
});

test('mobile API transport preserves refresh credentials when refresh is temporarily unavailable', async () => {
  let accessToken: string | null = 'expired-access-token';
  let storedRefreshToken: string | null = refreshToken;
  let clearRefreshTokenCalls = 0;
  let authExpiredCalls = 0;

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }

    if (path === '/api/auth/token/refresh') {
      return json({ error: { code: 'INTERNAL_ERROR', message: 'Temporarily unavailable' } }, 503);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { auth: client } = createTestApis({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken;
    },
    getRefreshToken: async () => storedRefreshToken,
    setRefreshToken: async (nextRefreshToken) => {
      storedRefreshToken = nextRefreshToken;
    },
    clearRefreshToken: async () => {
      clearRefreshTokenCalls += 1;
      storedRefreshToken = null;
    },
    onAuthExpired: () => {
      authExpiredCalls += 1;
    },
  });

  await expect(client.me()).rejects.toMatchObject({
    status: 503,
    code: 'INTERNAL_ERROR',
  });

  expect(accessToken).toBe('expired-access-token');
  expect(storedRefreshToken).toBe(refreshToken);
  expect(clearRefreshTokenCalls).toBe(0);
  expect(authExpiredCalls).toBe(0);
});

test('mobile auth API sends the stored refresh token when logging out', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });

    if (path === '/api/auth/token/logout') {
      return new Response(null, {
        status: 204,
        headers: {
          'X-Auth-Session-Revoked': 'true',
        },
      });
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { auth: client } = createTestApis({
    getAccessToken: () => null,
    setAccessToken: () => undefined,
    getRefreshToken: async () => refreshToken,
    setRefreshToken: async () => undefined,
    clearRefreshToken: async () => undefined,
  });

  await expect(client.logout({ expoPushToken: 'ExponentPushToken[logout-token]' })).resolves.toBe(true);

  expect(calls).toEqual([
    {
      path: '/api/auth/token/logout',
      body: {
        expoPushToken: 'ExponentPushToken[logout-token]',
        refreshToken,
      },
    },
  ]);
});

test('mobile auth API can send all known Expo push tokens when logging out', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });

    if (path === '/api/auth/token/logout') {
      return new Response(null, {
        status: 204,
        headers: {
          'X-Auth-Session-Revoked': 'true',
        },
      });
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { auth: client } = createTestApis({
    getAccessToken: () => null,
    setAccessToken: () => undefined,
    getRefreshToken: async () => refreshToken,
    setRefreshToken: async () => undefined,
    clearRefreshToken: async () => undefined,
  });

  await expect(
    client.logout({
      expoPushTokens: ['ExponentPushToken[logout-token]', 'ExponentPushToken[old-token]'],
    }),
  ).resolves.toBe(true);

  expect(calls).toEqual([
    {
      path: '/api/auth/token/logout',
      body: {
        expoPushTokens: ['ExponentPushToken[logout-token]', 'ExponentPushToken[old-token]'],
        refreshToken,
      },
    },
  ]);
});

test('mobile auth API exchanges social auth provider tokens', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });

    if (path === '/api/auth/token/social/google') {
      return json(
        {
          user: {
            id: 'user_1',
            email: 'social@example.com',
            displayName: 'Social User',
            role: 'user',
            createdAt: '2026-05-11T00:00:00.000Z',
            subscription: inactiveSubscription,
          },
          accessToken: 'social-access-token',
          refreshToken: rotatedRefreshToken,
        },
        200,
      );
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { auth: client } = createTestApis({
    getAccessToken: () => null,
    setAccessToken: () => undefined,
    getRefreshToken: async () => null,
    setRefreshToken: async () => undefined,
    clearRefreshToken: async () => undefined,
  });

  const response = await client.socialAuth('google', {
    idToken: 'google-id-token',
    displayName: 'Social User',
  });

  expect(response.accessToken).toBe('social-access-token');
  expect(response.refreshToken).toBe(rotatedRefreshToken);
  expect(calls).toEqual([
    {
      path: '/api/auth/token/social/google',
      body: {
        idToken: 'google-id-token',
        displayName: 'Social User',
      },
    },
  ]);
});

test('mobile billing API calls entitlement, ingest, and reconcile endpoints with auth', async () => {
  const calls: Array<{ path: string; authorization: string | null; body: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, authorization: headers.get('Authorization'), body });

    if (path === '/api/iap/entitlement') {
      return json({ subscription: inactiveSubscription }, 200);
    }

    if (path === '/api/iap/app-store/transactions') {
      return json({ subscription: { ...inactiveSubscription, state: 'active', isActive: true } }, 200);
    }

    if (path === '/api/iap/app-store/offer-code-redemption') {
      return json({ token: 'offer-code-redemption-token' }, 200);
    }

    if (path === '/api/iap/app-store/reconcile') {
      return json({ subscription: inactiveSubscription }, 200);
    }

    if (path === '/api/iap/google-play/transactions') {
      return json({ subscription: { ...inactiveSubscription, platform: 'android', state: 'active', isActive: true } }, 200);
    }

    if (path === '/api/iap/google-play/reconcile') {
      return json({ subscription: inactiveSubscription }, 200);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { billing: client } = createTestApis({
    getAccessToken: () => 'access-token',
    setAccessToken: () => undefined,
    getRefreshToken: async () => refreshToken,
    setRefreshToken: async () => undefined,
    clearRefreshToken: async () => undefined,
  });

  await expect(client.entitlement()).resolves.toEqual({ subscription: inactiveSubscription });
  await expect(
    client.ingestAppStoreTransaction({ signedTransactionInfo: 'signed-transaction' }),
  ).resolves.toMatchObject({ subscription: { isActive: true } });
  await expect(client.createAppStoreOfferCodeRedemption()).resolves.toEqual({
    token: 'offer-code-redemption-token',
  });
  await expect(
    client.reconcileAppStoreTransactions({ signedTransactions: ['signed-transaction'] }),
  ).resolves.toEqual({ subscription: inactiveSubscription });
  await expect(
    client.ingestGooglePlayTransaction({
      basePlanId: 'monthly',
      productId: 'premium',
      purchaseToken: 'purchase-token',
    }),
  ).resolves.toMatchObject({ subscription: { isActive: true, platform: 'android' } });
  await expect(
    client.reconcileGooglePlayTransactions({
      purchases: [{ productId: 'premium', purchaseToken: 'purchase-token' }],
    }),
  ).resolves.toEqual({ subscription: inactiveSubscription });

  expect(calls).toEqual([
    {
      path: '/api/iap/entitlement',
      authorization: 'Bearer access-token',
      body: undefined,
    },
    {
      path: '/api/iap/app-store/transactions',
      authorization: 'Bearer access-token',
      body: { signedTransactionInfo: 'signed-transaction' },
    },
    {
      path: '/api/iap/app-store/offer-code-redemption',
      authorization: 'Bearer access-token',
      body: undefined,
    },
    {
      path: '/api/iap/app-store/reconcile',
      authorization: 'Bearer access-token',
      body: { signedTransactions: ['signed-transaction'] },
    },
    {
      path: '/api/iap/google-play/transactions',
      authorization: 'Bearer access-token',
      body: { basePlanId: 'monthly', productId: 'premium', purchaseToken: 'purchase-token' },
    },
    {
      path: '/api/iap/google-play/reconcile',
      authorization: 'Bearer access-token',
      body: { purchases: [{ productId: 'premium', purchaseToken: 'purchase-token' }] },
    },
  ]);
});

test('mobile notifications API registers, unregisters, and sends test pushes with auth', async () => {
  const calls: Array<{ path: string; authorization: string | null; body: unknown }> = [];
  const installationId = '018fd4f2-1f3a-7c88-bc49-333333333333';
  const installationSecret = '118fd4f2-1f3a-4c88-bc49-333333333333';

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, authorization: headers.get('Authorization'), body });

    if (path === '/api/notifications/push-token') {
      return json({ applied: true, ok: true }, 200);
    }

    if (path === '/api/notifications/push-token/unregister') {
      return json({ applied: true, ok: true }, 200);
    }

    if (path === '/api/notifications/test-push') {
      return json({ ok: true, outboxId: '018fd4f2-1f3a-7c88-bc49-333333333333' }, 200);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { notifications: client } = createTestApis({
    getAccessToken: () => 'access-token',
    setAccessToken: () => undefined,
    getRefreshToken: async () => refreshToken,
    setRefreshToken: async () => undefined,
    clearRefreshToken: async () => undefined,
  });

  await expect(
    client.registerExpoPushToken({
      expoPushToken: 'ExponentPushToken[token]',
      generation: 1,
      installationId,
      installationSecret,
      platform: 'ios',
      previousExpoPushTokens: [],
    }),
  ).resolves.toEqual({ applied: true, ok: true });
  await expect(
    client.unregisterExpoPushToken({
      expoPushTokens: ['ExponentPushToken[token]'],
      generation: 2,
      installationId,
      installationSecret,
    }),
  ).resolves.toEqual({ applied: true, ok: true });
  await expect(
    client.sendTestPushNotification({
      body: 'Ready',
      href: '/details/components',
      title: 'Push',
    }),
  ).resolves.toEqual({ ok: true, outboxId: '018fd4f2-1f3a-7c88-bc49-333333333333' });

  expect(calls).toEqual([
    {
      path: '/api/notifications/push-token',
      authorization: 'Bearer access-token',
      body: {
        expoPushToken: 'ExponentPushToken[token]',
        generation: 1,
        installationId,
        installationSecret,
        platform: 'ios',
        previousExpoPushTokens: [],
      },
    },
    {
      path: '/api/notifications/push-token/unregister',
      authorization: 'Bearer access-token',
      body: {
        expoPushTokens: ['ExponentPushToken[token]'],
        generation: 2,
        installationId,
        installationSecret,
      },
    },
    {
      path: '/api/notifications/test-push',
      authorization: 'Bearer access-token',
      body: {
        body: 'Ready',
        href: '/details/components',
        title: 'Push',
      },
    },
  ]);
});

test('mobile notifications API can unregister push tokens without an auth refresh retry', async () => {
  const calls: string[] = [];

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);

    if (path === '/api/notifications/push-token/unregister') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }

    if (path === '/api/auth/token/refresh') {
      return json({
        accessToken: 'fresh-access-token',
        refreshToken: rotatedRefreshToken,
      }, 200);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { notifications: client } = createTestApis({
    getAccessToken: () => 'expired-access-token',
    setAccessToken: () => undefined,
    getRefreshToken: async () => refreshToken,
    setRefreshToken: async () => undefined,
    clearRefreshToken: async () => undefined,
  });

  await expect(
    client.unregisterExpoPushToken(
      {
        expoPushTokens: ['ExponentPushToken[token]'],
        generation: 1,
        installationId: '018fd4f2-1f3a-7c88-bc49-333333333333',
        installationSecret: '118fd4f2-1f3a-4c88-bc49-333333333333',
      },
      { retryOnUnauthorized: false },
    ),
  ).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHORIZED',
  });

  expect(calls).toEqual(['/api/notifications/push-token/unregister']);
});

test('Expo web auth uses cookie endpoints and never receives a refresh token', async () => {
  const calls: Array<{
    body: unknown;
    credentials: RequestCredentials | undefined;
    path: string;
  }> = [];
  let storedRefreshTokenWrites = 0;

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      credentials: init?.credentials,
      path,
    });

    if (path === '/api/auth/register') {
      return json({
        accessToken: 'web-access-token',
        user: {
          id: 'user_1',
          email: 'web@example.com',
          displayName: null,
          role: 'user',
          createdAt: '2026-05-11T00:00:00.000Z',
          subscription: inactiveSubscription,
        },
      }, 201);
    }
    if (path === '/api/auth/refresh') {
      return json({
        accessToken: 'web-refreshed-access-token',
      }, 200);
    }
    if (path === '/api/auth/logout') return new Response(null, { status: 204 });
    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const { auth } = createTestApis(
    {
      getAccessToken: () => null,
      setAccessToken: () => undefined,
      getRefreshToken: async () => null,
      setRefreshToken: async () => {
        storedRefreshTokenWrites += 1;
      },
      clearRefreshToken: async () => undefined,
    },
    'cookie',
  );

  await expect(
    auth.register({ email: 'web@example.com', password: 'password123' }),
  ).resolves.not.toHaveProperty('refreshToken');
  await expect(auth.canRefresh()).resolves.toBe(true);
  await expect(auth.refresh()).resolves.toEqual({
    accessToken: 'web-refreshed-access-token',
  });
  await expect(auth.logout()).resolves.toBe(true);

  expect(storedRefreshTokenWrites).toBe(0);
  expect(calls).toEqual([
    {
      body: { email: 'web@example.com', password: 'password123' },
      credentials: 'include',
      path: '/api/auth/register',
    },
    { body: {}, credentials: 'include', path: '/api/auth/refresh' },
    { body: {}, credentials: 'include', path: '/api/auth/logout' },
  ]);
  expect(calls.some((call) => call.path.includes('/token/'))).toBe(false);
});

test('composition selects cookie auth only for the Expo web platform', () => {
  expect(authTransportForPlatform('web')).toBe('cookie');
  expect(authTransportForPlatform('ios')).toBe('token');
  expect(authTransportForPlatform('android')).toBe('token');
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function createTestApis(options: {
  clearRefreshToken: () => Promise<void>;
  getAccessToken: () => string | null;
  getRefreshToken: () => Promise<string | null>;
  onAuthExpired?: () => void | Promise<void>;
  setAccessToken: (accessToken: string | null) => void;
  setRefreshToken: (refreshToken: string) => Promise<void>;
}, authTransport: 'cookie' | 'token' = 'token') {
  let auth!: AuthApi;
  const generation = 0;
  const transport = new ApiTransport(
    {
      expire: async () => {
        try {
          await options.onAuthExpired?.();
        } finally {
          options.setAccessToken(null);
          await options.clearRefreshToken();
        }
      },
      getAccessToken: options.getAccessToken,
      getGeneration: () => generation,
      isGenerationCurrent: (candidate) => candidate === generation,
      refresh: (candidate) => auth.refresh(candidate),
      setAccessToken: (accessToken, candidate) => {
        if (candidate !== generation) return false;
        options.setAccessToken(accessToken);
        return true;
      },
    },
    undefined,
    authTransport === 'cookie' ? 'include' : undefined,
  );
  auth = new AuthApi(transport, {
    ...options,
    browserAuthCoordinator: authTransport === 'cookie'
      ? createBrowserAuthCoordinator(() => undefined, () => false)
      : undefined,
    getAccessToken: options.getAccessToken,
    getGeneration: () => generation,
    isGenerationCurrent: (candidate) => candidate === generation,
  }, authTransport);
  return {
    auth,
    billing: new BillingApi(transport),
    notifications: new NotificationsApi(transport),
  };
}
