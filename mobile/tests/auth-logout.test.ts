import { expect, test } from 'bun:test';

import { logoutWithPushCleanup } from '../src/features/auth/logout';

test('logoutWithPushCleanup clears pending push cleanup when access unregister succeeds', async () => {
  const calls: unknown[] = [];
  let storedCleared = false;
  let pendingCleared = false;

  await logoutWithPushCleanup({
    authApi: {
      logout: async (input) => {
        calls.push(['logout', input]);
        return false;
      },
    },
    clearPendingExpoPushTokenCleanup: async () => {
      pendingCleared = true;
    },
    clearStoredExpoPushToken: async () => {
      storedCleared = true;
    },
    getKnownExpoPushTokens: async () => ['ExponentPushToken[current-token]'],
    getStoredExpoPushToken: async () => 'ExponentPushToken[current-token]',
    getStoredRefreshToken: async () => 'r'.repeat(32),
    setPendingExpoPushTokenCleanup: async () => {
      calls.push(['set-pending']);
    },
    unregisterStoredExpoPushToken: async (options) => {
      calls.push(['unregister', { expoPushToken: 'ExponentPushToken[current-token]' }, options]);
    },
  });

  expect(calls).toEqual([
    [
      'unregister',
      { expoPushToken: 'ExponentPushToken[current-token]' },
      { clearStoredOnFailure: true, retryOnUnauthorized: false },
    ],
    [
      'logout',
      {
        expoPushToken: 'ExponentPushToken[current-token]',
        expoPushTokens: ['ExponentPushToken[current-token]'],
        refreshToken: 'r'.repeat(32),
      },
    ],
  ]);
  expect(storedCleared).toBe(true);
  expect(pendingCleared).toBe(true);
});

test('logoutWithPushCleanup preserves pending cleanup when access unregister and refresh logout lack authority', async () => {
  const pendingTokens: string[] = [];
  let storedCleared = false;
  let pendingCleared = false;

  await logoutWithPushCleanup({
    authApi: { logout: async () => false },
    clearPendingExpoPushTokenCleanup: async () => {
      pendingCleared = true;
    },
    clearStoredExpoPushToken: async () => {
      storedCleared = true;
    },
    getKnownExpoPushTokens: async () => [
      'ExponentPushToken[current-token]',
      'ExponentPushToken[pending-token]',
    ],
    getStoredExpoPushToken: async () => 'ExponentPushToken[current-token]',
    getStoredRefreshToken: async () => 'r'.repeat(32),
    setPendingExpoPushTokenCleanup: async (token) => {
      pendingTokens.push(token);
    },
    unregisterStoredExpoPushToken: async () => {
      throw new Error('unauthorized');
    },
  });

  expect(pendingTokens).toEqual([
    'ExponentPushToken[current-token]',
    'ExponentPushToken[pending-token]',
  ]);
  expect(storedCleared).toBe(true);
  expect(pendingCleared).toBe(false);
});

test('logoutWithPushCleanup clears pending cleanup when refresh logout confirms session revocation', async () => {
  const pendingTokens: string[] = [];
  let pendingCleared = false;

  await logoutWithPushCleanup({
    authApi: {
      logout: async (input) => {
        expect(input.refreshToken).toBe('r'.repeat(32));
        return true;
      },
    },
    clearPendingExpoPushTokenCleanup: async () => {
      pendingCleared = true;
    },
    clearStoredExpoPushToken: async () => undefined,
    getKnownExpoPushTokens: async () => ['ExponentPushToken[current-token]'],
    getStoredExpoPushToken: async () => 'ExponentPushToken[current-token]',
    getStoredRefreshToken: async () => 'r'.repeat(32),
    setPendingExpoPushTokenCleanup: async (token) => {
      pendingTokens.push(token);
    },
    unregisterStoredExpoPushToken: async () => {
      throw new Error('offline');
    },
  });

  expect(pendingCleared).toBe(true);
  expect(pendingTokens).toEqual([]);
});
