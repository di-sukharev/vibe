import { expect, test } from 'bun:test';

import {
  unregisterKnownExpoPushTokens,
  uniqueExpoPushTokens,
  type PushTokenCleanupStorage,
} from '../src/features/notifications/push-token-cleanup';

test('unregisterKnownExpoPushTokens clears only tokens confirmed by the backend', async () => {
  const calls: unknown[] = [];
  const storage = createCleanupStorage({
    pendingTokens: ['ExponentPushToken[pending-token]'],
    storedToken: 'ExponentPushToken[stored-token]',
  });

  await unregisterKnownExpoPushTokens({
    api: {
      unregisterExpoPushToken: async (input) => {
        calls.push(input);
      },
    },
    storage,
  });

  expect(calls).toEqual([
    { expoPushToken: 'ExponentPushToken[stored-token]' },
    { expoPushToken: 'ExponentPushToken[pending-token]' },
  ]);
  expect(storage.snapshot()).toEqual({
    pendingTokens: [],
    storedToken: null,
  });
});

test('unregisterKnownExpoPushTokens keeps failed tokens as pending cleanup evidence', async () => {
  const calls: unknown[] = [];
  const storage = createCleanupStorage({
    pendingTokens: ['ExponentPushToken[pending-token]'],
    storedToken: 'ExponentPushToken[stored-token]',
  });

  await expect(
    unregisterKnownExpoPushTokens({
      api: {
        unregisterExpoPushToken: async (input) => {
          calls.push(input);
          if (input?.expoPushToken === 'ExponentPushToken[stored-token]') {
            throw new Error('offline');
          }
        },
      },
      clearStoredOnFailure: true,
      storage,
    }),
  ).rejects.toThrow('offline');

  expect(calls).toEqual([
    { expoPushToken: 'ExponentPushToken[stored-token]' },
    { expoPushToken: 'ExponentPushToken[pending-token]' },
  ]);
  expect(storage.snapshot()).toEqual({
    pendingTokens: ['ExponentPushToken[stored-token]'],
    storedToken: null,
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
}): PushTokenCleanupStorage & { snapshot: () => { pendingTokens: string[]; storedToken: string | null } } {
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
