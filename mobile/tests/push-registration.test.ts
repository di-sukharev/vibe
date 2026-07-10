import { expect, test } from 'bun:test';

import {
  cleanupExpoPushRegistrationAfterPermissionDenied,
  syncExpoPushTokenRegistration,
} from '../src/features/notifications/push-registration';

test('syncExpoPushTokenRegistration registers and stores a new token', async () => {
  const calls: unknown[] = [];
  let storedToken: string | null = null;

  const result = await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register', input]);
      },
      unregisterExpoPushToken: async (input) => {
        calls.push(['unregister', input]);
      },
    },
    expoPushToken: 'ExponentPushToken[new-token]',
    getStoredExpoPushToken: async () => storedToken,
    platform: 'ios',
    setStoredExpoPushToken: async (nextToken) => {
      storedToken = nextToken;
      calls.push(['store', nextToken]);
    },
  });

  expect(result).toEqual({ changed: true, previousToken: null });
  expect(storedToken).toBe('ExponentPushToken[new-token]');
  expect(calls).toEqual([
    [
      'register',
      {
        expoPushToken: 'ExponentPushToken[new-token]',
        platform: 'ios',
      },
    ],
    ['store', 'ExponentPushToken[new-token]'],
  ]);
});

test('syncExpoPushTokenRegistration unregisters the previous token after rotation', async () => {
  const calls: unknown[] = [];
  let pendingCleanupToken: string | null = null;
  let storedToken: string | null = 'ExponentPushToken[old-token]';

  const result = await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register', input]);
      },
      unregisterExpoPushToken: async (input) => {
        calls.push(['unregister', input]);
      },
    },
    clearPendingExpoPushTokenCleanup: async () => {
      pendingCleanupToken = null;
      calls.push(['clear-pending']);
    },
    expoPushToken: 'ExponentPushToken[new-token]',
    getPendingExpoPushTokenCleanup: async () => pendingCleanupToken,
    getStoredExpoPushToken: async () => storedToken,
    platform: 'android',
    setPendingExpoPushTokenCleanup: async (token) => {
      pendingCleanupToken = token;
      calls.push(['pending', token]);
    },
    setStoredExpoPushToken: async (nextToken) => {
      storedToken = nextToken;
      calls.push(['store', nextToken]);
    },
  });

  expect(result).toEqual({
    changed: true,
    previousToken: 'ExponentPushToken[old-token]',
  });
  expect(storedToken).toBe('ExponentPushToken[new-token]');
  expect(calls).toEqual([
    [
      'register',
      {
        expoPushToken: 'ExponentPushToken[new-token]',
        platform: 'android',
      },
    ],
    ['pending', 'ExponentPushToken[old-token]'],
    ['unregister', { expoPushToken: 'ExponentPushToken[old-token]' }],
    ['clear-pending'],
    ['store', 'ExponentPushToken[new-token]'],
  ]);
  expect(pendingCleanupToken).toBeNull();
});

test('syncExpoPushTokenRegistration does not overwrite storage when register fails', async () => {
  let storedToken: string | null = 'ExponentPushToken[old-token]';
  let unregisterCalls = 0;
  let storeCalls = 0;

  await expect(
    syncExpoPushTokenRegistration({
      api: {
        registerExpoPushToken: async () => {
          throw new Error('register failed');
        },
        unregisterExpoPushToken: async () => {
          unregisterCalls += 1;
        },
      },
      expoPushToken: 'ExponentPushToken[new-token]',
      getStoredExpoPushToken: async () => storedToken,
      platform: 'ios',
      setStoredExpoPushToken: async (nextToken) => {
        storedToken = nextToken;
        storeCalls += 1;
      },
    }),
  ).rejects.toThrow('register failed');

  expect(storedToken).toBe('ExponentPushToken[old-token]');
  expect(unregisterCalls).toBe(0);
  expect(storeCalls).toBe(0);
});

test('syncExpoPushTokenRegistration ignores best-effort unregister failures', async () => {
  let pendingCleanupToken: string | null = null;
  let storedToken: string | null = 'ExponentPushToken[old-token]';

  await expect(
    syncExpoPushTokenRegistration({
      api: {
        registerExpoPushToken: async () => undefined,
        unregisterExpoPushToken: async () => {
          throw new Error('offline');
        },
      },
      clearPendingExpoPushTokenCleanup: async () => {
        pendingCleanupToken = null;
      },
      expoPushToken: 'ExponentPushToken[new-token]',
      getPendingExpoPushTokenCleanup: async () => pendingCleanupToken,
      getStoredExpoPushToken: async () => storedToken,
      platform: 'ios',
      setPendingExpoPushTokenCleanup: async (token) => {
        pendingCleanupToken = token;
      },
      setStoredExpoPushToken: async (nextToken) => {
        storedToken = nextToken;
      },
    }),
  ).resolves.toEqual({
    changed: true,
    previousToken: 'ExponentPushToken[old-token]',
  });

  expect(storedToken).toBe('ExponentPushToken[new-token]');
  expect(pendingCleanupToken).toBe('ExponentPushToken[old-token]');
});

test('syncExpoPushTokenRegistration retries pending cleanup before unchanged-token no-op', async () => {
  const calls: unknown[] = [];
  let pendingCleanupToken: string | null = 'ExponentPushToken[old-token]';

  const result = await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register', input]);
      },
      unregisterExpoPushToken: async (input) => {
        calls.push(['unregister', input]);
      },
    },
    clearPendingExpoPushTokenCleanup: async () => {
      pendingCleanupToken = null;
      calls.push(['clear-pending']);
    },
    expoPushToken: 'ExponentPushToken[same-token]',
    getPendingExpoPushTokenCleanup: async () => pendingCleanupToken,
    getStoredExpoPushToken: async () => 'ExponentPushToken[same-token]',
    platform: 'ios',
    setPendingExpoPushTokenCleanup: async (token) => {
      pendingCleanupToken = token;
      calls.push(['pending', token]);
    },
    setStoredExpoPushToken: async (token) => {
      calls.push(['store', token]);
    },
  });

  expect(result).toEqual({
    changed: false,
    previousToken: 'ExponentPushToken[same-token]',
  });
  expect(pendingCleanupToken).toBeNull();
  expect(calls).toEqual([
    ['unregister', { expoPushToken: 'ExponentPushToken[old-token]' }],
    ['clear-pending'],
  ]);
});

test('syncExpoPushTokenRegistration is a no-op for unchanged tokens', async () => {
  let backendCalls = 0;

  const result = await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async () => {
        backendCalls += 1;
      },
      unregisterExpoPushToken: async () => {
        backendCalls += 1;
      },
    },
    expoPushToken: 'ExponentPushToken[same-token]',
    getStoredExpoPushToken: async () => 'ExponentPushToken[same-token]',
    platform: 'ios',
    setStoredExpoPushToken: async () => {
      backendCalls += 1;
    },
  });

  expect(result).toEqual({
    changed: false,
    previousToken: 'ExponentPushToken[same-token]',
  });
  expect(backendCalls).toBe(0);
});

test('cleanupExpoPushRegistrationAfterPermissionDenied unregisters local backend state best-effort', async () => {
  let cleanupCalls = 0;

  await cleanupExpoPushRegistrationAfterPermissionDenied({
    unregisterStoredExpoPushToken: async () => {
      cleanupCalls += 1;
      throw new Error('offline');
    },
  });

  expect(cleanupCalls).toBe(1);
});
