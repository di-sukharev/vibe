import { expect, test } from 'bun:test';

import { clearBootstrapAuthState, refreshBootstrapSession } from '../src/features/auth/bootstrap';

test('refreshBootstrapSession returns null without stored refresh token', async () => {
  let refreshCalls = 0;

  const result = await refreshBootstrapSession(
    {
      canRefresh: async () => false,
      refresh: async () => {
        refreshCalls += 1;
        return { accessToken: 'access-token' };
      },
    } as never,
  );

  expect(result).toBeNull();
  expect(refreshCalls).toBe(0);
});

test('refreshBootstrapSession deduplicates concurrent refresh attempts and resets after failure', async () => {
  let refreshCalls = 0;
  const api = {
    canRefresh: async () => true,
    refresh: async () => {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (refreshCalls === 1) {
        throw new Error('expired refresh');
      }
      return { accessToken: 'fresh-access-token' };
    },
  } as never;

  const first = refreshBootstrapSession(api);
  const second = refreshBootstrapSession(api);

  await expect(first).rejects.toThrow('expired refresh');
  await expect(second).rejects.toThrow('expired refresh');
  expect(refreshCalls).toBe(1);

  await expect(refreshBootstrapSession(api)).resolves.toEqual({
    accessToken: 'fresh-access-token',
  });
  expect(refreshCalls).toBe(2);
});

test('web token store never exposes refresh credentials to browser JavaScript storage', async () => {
  const source = await Bun.file('src/features/auth/token-store.ts').text();
  expect(source).not.toContain('localStorage');
  expect(source).not.toContain('sessionStorage');
});

test('clearBootstrapAuthState clears access and refresh while preserving Expo push cleanup evidence', async () => {
  let accessToken: string | null = 'expired-access-token';
  let refreshCleared = false;
  let expoPushTokenMarkedForCleanup = false;
  let expoPushTokenCleared = false;

  await clearBootstrapAuthState({
    clearStoredExpoPushToken: async () => {
      expoPushTokenCleared = true;
    },
    clearStoredRefreshToken: async () => {
      refreshCleared = true;
    },
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken;
    },
    markStoredExpoPushTokenForCleanup: async () => {
      expoPushTokenMarkedForCleanup = true;
    },
  });

  expect(accessToken).toBeNull();
  expect(refreshCleared).toBe(true);
  expect(expoPushTokenMarkedForCleanup).toBe(true);
  expect(expoPushTokenCleared).toBe(false);
});
