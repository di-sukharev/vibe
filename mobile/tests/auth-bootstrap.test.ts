import { expect, test } from 'bun:test';

import { clearBootstrapAuthState, refreshBootstrapSession } from '../src/features/auth/bootstrap';

test('refreshBootstrapSession returns null without stored refresh token', async () => {
  let refreshCalls = 0;

  const result = await refreshBootstrapSession(
    {
      refresh: async () => {
        refreshCalls += 1;
        return { accessToken: 'access-token' };
      },
    } as never,
    async () => null,
  );

  expect(result).toBeNull();
  expect(refreshCalls).toBe(0);
});

test('refreshBootstrapSession deduplicates concurrent refresh attempts and resets after failure', async () => {
  let refreshCalls = 0;
  const api = {
    refresh: async () => {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (refreshCalls === 1) {
        throw new Error('expired refresh');
      }
      return { accessToken: 'fresh-access-token' };
    },
  } as never;

  const first = refreshBootstrapSession(api, async () => 'r'.repeat(32));
  const second = refreshBootstrapSession(api, async () => 'r'.repeat(32));

  await expect(first).rejects.toThrow('expired refresh');
  await expect(second).rejects.toThrow('expired refresh');
  expect(refreshCalls).toBe(1);

  await expect(refreshBootstrapSession(api, async () => 'r'.repeat(32))).resolves.toEqual({
    accessToken: 'fresh-access-token',
  });
  expect(refreshCalls).toBe(2);
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
