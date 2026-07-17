import { expect, test } from 'bun:test';

import {
  unregisterKnownExpoPushTokens,
  uniqueExpoPushTokens,
  type PushTokenCleanupStorage,
} from '../src/features/notifications/push-token-cleanup';

const installationId = '018fd4f2-1f3a-7c88-bc49-333333333333';
const installationSecret = '118fd4f2-1f3a-4c88-bc49-333333333333';

test('unregisterKnownExpoPushTokens clears evidence only after the server applies the generation', async () => {
  const calls: unknown[] = [];
  const storage = createCleanupStorage({
    pendingTokens: ['ExponentPushToken[pending-token]'],
    storedToken: 'ExponentPushToken[stored-token]',
  });

  await unregisterKnownExpoPushTokens({
    api: {
      unregisterExpoPushToken: async (input) => {
        calls.push(input);
        return { applied: true, ok: true };
      },
    },
    beginInstallationMutation: async () => ({
      generation: 4,
      installationId,
      installationSecret,
    }),
    commitInstallationDeactivation: async (mutation) => {
      calls.push(['commit', mutation]);
      await storage.clearStoredExpoPushToken();
      await storage.clearPendingExpoPushTokenCleanup();
      return true;
    },
    storage,
  });

  expect(calls).toEqual([
    {
      expoPushTokens: [
        'ExponentPushToken[stored-token]',
        'ExponentPushToken[pending-token]',
      ],
      generation: 4,
      installationId,
      installationSecret,
    },
    ['commit', { generation: 4, installationId, installationSecret }],
  ]);
  expect(storage.snapshot()).toEqual({
    pendingTokens: [],
    storedToken: null,
  });
});

test('unregisterKnownExpoPushTokens keeps all evidence when the request fails', async () => {
  const storage = createCleanupStorage({
    pendingTokens: ['ExponentPushToken[pending-token]'],
    storedToken: 'ExponentPushToken[stored-token]',
  });

  await expect(unregisterKnownExpoPushTokens({
    api: {
      unregisterExpoPushToken: async () => {
        throw new Error('offline');
      },
    },
    beginInstallationMutation: async () => ({
      generation: 5,
      installationId,
      installationSecret,
    }),
    clearStoredExpoPushTokenForMutation: async () => {
      await storage.clearStoredExpoPushToken();
      return true;
    },
    clearStoredOnFailure: true,
    commitInstallationDeactivation: async () => false,
    storage,
  })).rejects.toThrow('offline');

  expect(storage.snapshot()).toEqual({
    pendingTokens: [
      'ExponentPushToken[pending-token]',
      'ExponentPushToken[stored-token]',
    ],
    storedToken: null,
  });
});

test('unregisterKnownExpoPushTokens keeps evidence when the server rejects a stale generation', async () => {
  let commitCalls = 0;
  const storage = createCleanupStorage({
    pendingTokens: ['ExponentPushToken[account-a-token]'],
    storedToken: null,
  });

  await unregisterKnownExpoPushTokens({
    api: {
      unregisterExpoPushToken: async () => ({ applied: false, ok: true }),
    },
    beginInstallationMutation: async () => ({
      generation: 1,
      installationId,
      installationSecret,
    }),
    commitInstallationDeactivation: async () => {
      commitCalls += 1;
      return false;
    },
    storage,
  });

  expect(commitCalls).toBe(0);
  expect(storage.snapshot()).toEqual({
    pendingTokens: ['ExponentPushToken[account-a-token]'],
    storedToken: null,
  });
});

test('permission-denied cleanup cannot start an installation mutation as a new account', async () => {
  const storedTokenRead = createDeferred<void>();
  const storedTokenReadStarted = createDeferred<void>();
  const calls: unknown[] = [];
  let isCancelled = false;

  const cleanup = unregisterKnownExpoPushTokens({
    api: {
      unregisterExpoPushToken: async (input) => {
        calls.push(['unregister', input]);
        return { applied: true, ok: true };
      },
    },
    beginInstallationMutation: async () => {
      calls.push(['begin']);
      return { generation: 1, installationId, installationSecret };
    },
    commitInstallationDeactivation: async () => {
      calls.push(['commit']);
      return true;
    },
    isCancelled: () => isCancelled,
    storage: {
      clearPendingExpoPushTokenCleanup: async () => undefined,
      clearStoredExpoPushToken: async () => undefined,
      getPendingExpoPushTokenCleanupTokens: async () => [],
      getStoredExpoPushToken: async () => {
        storedTokenReadStarted.resolve();
        await storedTokenRead.promise;
        return 'ExponentPushToken[account-a-token]';
      },
      setPendingExpoPushTokenCleanup: async () => undefined,
    },
  });

  await storedTokenReadStarted.promise;
  isCancelled = true;
  storedTokenRead.resolve();
  await cleanup;

  expect(calls).toEqual([]);
});

test('permission-denied cleanup preserves evidence when cancelled during unregister', async () => {
  const unregisterCall = createDeferred<void>();
  const unregisterStarted = createDeferred<void>();
  const calls: unknown[] = [];
  const storage = createCleanupStorage({
    pendingTokens: [],
    storedToken: 'ExponentPushToken[account-a-token]',
  });
  let isCancelled = false;

  const cleanup = unregisterKnownExpoPushTokens({
    api: {
      unregisterExpoPushToken: async (input) => {
        calls.push(['unregister', input]);
        unregisterStarted.resolve();
        await unregisterCall.promise;
        return { applied: true, ok: true };
      },
    },
    beginInstallationMutation: async () => ({
      generation: 2,
      installationId,
      installationSecret,
    }),
    clearStoredOnFailure: true,
    commitInstallationDeactivation: async () => {
      calls.push(['commit']);
      return true;
    },
    isCancelled: () => isCancelled,
    storage,
  });

  await unregisterStarted.promise;
  isCancelled = true;
  unregisterCall.resolve();
  await cleanup;

  expect(calls).toEqual([
    [
      'unregister',
      {
        expoPushTokens: ['ExponentPushToken[account-a-token]'],
        generation: 2,
        installationId,
        installationSecret,
      },
    ],
  ]);
  expect(storage.snapshot()).toEqual({
    pendingTokens: ['ExponentPushToken[account-a-token]'],
    storedToken: 'ExponentPushToken[account-a-token]',
  });
});

test('uniqueExpoPushTokens removes empty and duplicate cleanup tokens', () => {
  expect(
    uniqueExpoPushTokens([
      null,
      'ExponentPushToken[token]',
      undefined,
      'ExponentPushToken[token]',
      'ExponentPushToken[other-token]',
    ]),
  ).toEqual(['ExponentPushToken[token]', 'ExponentPushToken[other-token]']);
});

function createCleanupStorage(input: {
  pendingTokens: string[];
  storedToken: string | null;
}): PushTokenCleanupStorage & {
  snapshot: () => { pendingTokens: string[]; storedToken: string | null };
} {
  let storedToken = input.storedToken;
  let pendingTokens = [...input.pendingTokens];

  return {
    clearPendingExpoPushTokenCleanup: async (expoPushToken) => {
      pendingTokens = expoPushToken
        ? pendingTokens.filter((token) => token !== expoPushToken)
        : [];
    },
    clearStoredExpoPushToken: async () => {
      storedToken = null;
    },
    getPendingExpoPushTokenCleanupTokens: async () => pendingTokens,
    getStoredExpoPushToken: async () => storedToken,
    setPendingExpoPushTokenCleanup: async (expoPushToken) => {
      pendingTokens = uniqueExpoPushTokens([...pendingTokens, expoPushToken]);
    },
    snapshot: () => ({
      pendingTokens,
      storedToken,
    }),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
