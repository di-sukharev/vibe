import { expect, test } from 'bun:test';

import {
  clearBootstrapAuthState,
  restoreBootstrapAuthState,
  refreshBootstrapSession,
} from '../src/features/auth/bootstrap';
import {
  logoutWithPushCleanup,
  preserveExpiredSessionPushEvidence,
} from '../src/features/auth/logout';
import { ApiRequestError } from '../src/platform/api';

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

test('refreshBootstrapSession never shares credentials across API instances', async () => {
  let firstRefreshCalls = 0;
  let secondRefreshCalls = 0;
  const firstApi = {
    canRefresh: async () => true,
    refresh: async () => {
      firstRefreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { accessToken: 'first-access-token' };
    },
  } as never;
  const secondApi = {
    canRefresh: async () => true,
    refresh: async () => {
      secondRefreshCalls += 1;
      return { accessToken: 'second-access-token' };
    },
  } as never;

  await expect(
    Promise.all([
      refreshBootstrapSession(firstApi),
      refreshBootstrapSession(secondApi),
    ]),
  ).resolves.toEqual([
    { accessToken: 'first-access-token' },
    { accessToken: 'second-access-token' },
  ]);
  expect(firstRefreshCalls).toBe(1);
  expect(secondRefreshCalls).toBe(1);
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

test('expired-session push preservation is bounded when local cleanup never settles', async () => {
  let cancelled = false;
  let observedCancellation: (() => boolean) | undefined;

  await expect(preserveExpiredSessionPushEvidence({
    drainPushRegistrations: async () => undefined,
    isCancelled: () => cancelled,
    markStoredExpoPushTokenForCleanup: async (options) => {
      observedCancellation = options?.isCancelled;
      await new Promise(() => {});
    },
  }, 5)).resolves.toBeUndefined();

  cancelled = true;
  expect(observedCancellation?.()).toBe(true);
});

test('restoreBootstrapAuthState preserves credentials for a retryable backend outage', async () => {
  let clearCalls = 0;

  const result = await restoreBootstrapAuthState(
    {
      canRefresh: async () => true,
      refresh: async () => {
        throw new ApiRequestError(503, 'INTERNAL_ERROR', 'Temporarily unavailable');
      },
    } as never,
    {
      clear: async () => {
        clearCalls += 1;
      },
    },
  );

  expect(result).toMatchObject({ status: 'retryable-error' });
  expect(clearCalls).toBe(0);
});

test('restoreBootstrapAuthState clears credentials for a rejected refresh credential', async () => {
  let clearCalls = 0;

  const result = await restoreBootstrapAuthState(
    {
      canRefresh: async () => true,
      refresh: async () => {
        throw new ApiRequestError(401, 'UNAUTHORIZED', 'Invalid refresh token');
      },
    } as never,
    {
      clear: async () => {
        clearCalls += 1;
      },
    },
  );

  expect(result).toEqual({ status: 'anonymous' });
  expect(clearCalls).toBe(1);
});

test('restoreBootstrapAuthState makes terminal cleanup failures retryable', async () => {
  const clearFailure = new Error('secure storage unavailable');

  const result = await restoreBootstrapAuthState(
    {
      canRefresh: async () => true,
      refresh: async () => {
        throw new ApiRequestError(401, 'UNAUTHORIZED', 'Invalid refresh token');
      },
    } as never,
    {
      clear: async () => {
        throw clearFailure;
      },
    },
  );

  expect(result).toEqual({ status: 'retryable-error', error: clearFailure });
});

test('crash after local logout clear resumes durable logout before refresh on recreated bootstrap', async () => {
  const refreshCredential = 'r'.repeat(32);
  const pushToken = 'ExponentPushToken[crash-restart]';
  const state = {
    accessToken: 'access-token' as string | null,
    logoutIntentPending: false,
    refreshToken: refreshCredential as string | null,
  };
  let refreshCalls = 0;
  let logoutCalls = 0;

  await expect(logoutWithPushCleanup({
    authApi: {
      prepareLogout: () => async () => {
        logoutCalls += 1;
        return true;
      },
    },
    clearLocalSession: async () => {
      state.accessToken = null;
      throw new Error('simulated process kill');
    },
    clearPendingExpoPushTokenCleanup: async () => undefined,
    clearStoredExpoPushToken: async () => undefined,
    completePendingLogout: async () => {
      state.refreshToken = null;
      state.logoutIntentPending = false;
    },
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [pushToken],
    getStoredExpoPushToken: async () => pushToken,
    getStoredRefreshToken: async () => state.refreshToken,
    markPendingLogout: async () => {
      state.logoutIntentPending = true;
    },
    sessionGeneration: 1,
    setPendingExpoPushTokenCleanup: async () => undefined,
  })).rejects.toThrow('simulated process kill');

  expect(state).toEqual({
    accessToken: null,
    logoutIntentPending: true,
    refreshToken: refreshCredential,
  });
  expect(logoutCalls).toBe(0);

  const restored = await restoreBootstrapAuthState(
    {
      canRefresh: async () => true,
      refresh: async () => {
        refreshCalls += 1;
        return { accessToken: 'must-not-be-used' };
      },
    } as never,
    {
      clear: async () => undefined,
      getPendingLogout: async () => state.logoutIntentPending,
      resumePendingLogout: () => logoutWithPushCleanup({
        authApi: {
          prepareLogout: () => async (input) => {
            logoutCalls += 1;
            expect(input).toEqual({
              expoPushToken: pushToken,
              expoPushTokens: [pushToken],
              refreshToken: refreshCredential,
            });
            return true;
          },
        },
        clearLocalSession: async () => {
          state.accessToken = null;
        },
        clearPendingExpoPushTokenCleanup: async () => undefined,
        clearStoredExpoPushToken: async () => undefined,
        completePendingLogout: async () => {
          state.refreshToken = null;
          state.logoutIntentPending = false;
        },
        drainPushRegistrations: async () => undefined,
        getKnownExpoPushTokens: async () => [pushToken],
        getStoredExpoPushToken: async () => pushToken,
        getStoredRefreshToken: async () => state.refreshToken,
        markPendingLogout: async () => {
          state.logoutIntentPending = true;
        },
        sessionGeneration: 0,
        setPendingExpoPushTokenCleanup: async () => undefined,
      }),
    },
  );

  expect(restored).toEqual({ status: 'anonymous' });
  expect(refreshCalls).toBe(0);
  expect(logoutCalls).toBe(1);
  expect(state.logoutIntentPending).toBe(false);
  expect(state.refreshToken).toBeNull();
});

test('pending logout bootstrap remains anonymous and retryable after timeout, then cleans authority in safe order', async () => {
  const events: string[] = [];
  const state = {
    logoutIntentPending: true,
    refreshToken: 'r'.repeat(32) as string | null,
  };
  let refreshCalls = 0;
  let logoutAttempt = 0;

  const restore = () => restoreBootstrapAuthState(
    {
      canRefresh: async () => true,
      refresh: async () => {
        refreshCalls += 1;
        return { accessToken: 'must-not-be-used' };
      },
    } as never,
    {
      clear: async () => undefined,
      getPendingLogout: async () => state.logoutIntentPending,
      resumePendingLogout: () => logoutWithPushCleanup({
        authApi: {
          prepareLogout: () => async () => {
            logoutAttempt += 1;
            if (logoutAttempt === 1) {
              return new Promise<boolean>(() => undefined);
            }
            events.push('server-terminal');
            return false;
          },
        },
        clearLocalSession: async () => {
          events.push('clear-local');
        },
        clearPendingExpoPushTokenCleanup: async () => undefined,
        clearStoredExpoPushToken: async () => undefined,
        completePendingLogout: async () => {
          events.push('clear-refresh');
          state.refreshToken = null;
          events.push('clear-intent');
          state.logoutIntentPending = false;
        },
        drainPushRegistrations: async () => undefined,
        getKnownExpoPushTokens: async () => [],
        getStoredExpoPushToken: async () => null,
        getStoredRefreshToken: async () => state.refreshToken,
        markPendingLogout: async () => {
          events.push('mark-intent');
          state.logoutIntentPending = true;
        },
        serverLogoutTimeoutMs: 5,
        sessionGeneration: 0,
        setPendingExpoPushTokenCleanup: async () => undefined,
      }),
    },
  );

  const timedOut = await restore();
  expect(timedOut.status).toBe('retryable-error');
  expect(state.logoutIntentPending).toBe(true);
  expect(state.refreshToken).toBe('r'.repeat(32));
  expect(refreshCalls).toBe(0);

  const recovered = await restore();
  expect(recovered).toEqual({ status: 'anonymous' });
  expect(state.logoutIntentPending).toBe(false);
  expect(state.refreshToken).toBeNull();
  expect(refreshCalls).toBe(0);
  expect(events.slice(-5)).toEqual([
    'mark-intent',
    'clear-local',
    'server-terminal',
    'clear-refresh',
    'clear-intent',
  ]);
});
