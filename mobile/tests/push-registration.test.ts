import { expect, test } from 'bun:test';

import {
  cleanupExpoPushRegistrationAfterPermissionDenied,
  syncExpoPushTokenRegistration,
} from '../src/features/notifications/push-registration';

const installationId = '018fd4f2-1f3a-7c88-bc49-333333333333';
const installationSecret = '118fd4f2-1f3a-4c88-bc49-333333333333';

test('syncExpoPushTokenRegistration durably claims and commits a new installation token', async () => {
  const calls: unknown[] = [];
  const storage = createInstallationStorage({ calls });

  const result = await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register', input]);
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[new-token]',
    platform: 'ios',
    userId: 'account-a',
  });

  expect(result).toEqual({ changed: true, previousToken: null });
  expect(calls).toEqual([
    ['begin', 1],
    ['pending', 'ExponentPushToken[new-token]'],
    [
      'register',
      {
        expoPushToken: 'ExponentPushToken[new-token]',
        generation: 1,
        installationId,
        installationSecret,
        platform: 'ios',
        previousExpoPushTokens: [],
      },
    ],
    ['commit', 1, 'account-a', 'ExponentPushToken[new-token]'],
  ]);
  expect(storage.snapshot()).toEqual({
    generation: 1,
    pendingTokens: [],
    registeredUserId: 'account-a',
    storedToken: 'ExponentPushToken[new-token]',
  });
});

test('account switch claims the installation and replaces previous tokens without user-scoped unregister', async () => {
  const calls: unknown[] = [];
  const storage = createInstallationStorage({
    calls,
    generation: 1,
    pendingTokens: ['ExponentPushToken[account-a-pending]'],
    registeredUserId: 'account-a',
    storedToken: 'ExponentPushToken[account-a-token]',
  });

  await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register', input]);
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[account-b-token]',
    platform: 'android',
    userId: 'account-b',
  });

  expect(calls).toContainEqual([
    'register',
    {
      expoPushToken: 'ExponentPushToken[account-b-token]',
      generation: 2,
      installationId,
      installationSecret,
      platform: 'android',
      previousExpoPushTokens: [
        'ExponentPushToken[account-a-token]',
        'ExponentPushToken[account-a-pending]',
      ],
    },
  ]);
  expect(storage.snapshot()).toEqual({
    generation: 2,
    pendingTokens: [],
    registeredUserId: 'account-b',
    storedToken: 'ExponentPushToken[account-b-token]',
  });
});

test('failed registration leaves every known token as durable replacement evidence', async () => {
  const storage = createInstallationStorage({
    generation: 4,
    pendingTokens: ['ExponentPushToken[pending-token]'],
    registeredUserId: 'account-a',
    storedToken: 'ExponentPushToken[stored-token]',
  });

  await expect(syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async () => {
        throw new Error('offline');
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[next-token]',
    platform: 'ios',
    userId: 'account-a',
  })).rejects.toThrow('offline');

  expect(storage.snapshot()).toEqual({
    generation: 5,
    pendingTokens: [
      'ExponentPushToken[pending-token]',
      'ExponentPushToken[stored-token]',
      'ExponentPushToken[next-token]',
    ],
    registeredUserId: 'account-a',
    storedToken: 'ExponentPushToken[stored-token]',
  });
});

test('unchanged token is a no-op only for the same confirmed account with no pending evidence', async () => {
  let backendCalls = 0;
  const storage = createInstallationStorage({
    generation: 3,
    registeredUserId: 'account-a',
    storedToken: 'ExponentPushToken[same-token]',
  });

  const result = await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async () => {
        backendCalls += 1;
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[same-token]',
    platform: 'ios',
    userId: 'account-a',
  });

  expect(result).toEqual({
    changed: false,
    previousToken: 'ExponentPushToken[same-token]',
  });
  expect(backendCalls).toBe(0);
  expect(storage.snapshot().generation).toBe(3);
});

test('launch revalidation re-registers an unchanged token so cap eviction can recover', async () => {
  const calls: unknown[] = [];
  const storage = createInstallationStorage({
    calls,
    generation: 3,
    registeredUserId: 'account-a',
    storedToken: 'ExponentPushToken[same-token]',
  });

  await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register', input]);
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[same-token]',
    forceRevalidation: true,
    platform: 'ios',
    userId: 'account-a',
  });

  expect(calls).toContainEqual([
    'register',
    {
      expoPushToken: 'ExponentPushToken[same-token]',
      generation: 4,
      installationId,
      installationSecret,
      platform: 'ios',
      previousExpoPushTokens: [],
    },
  ]);
});

test('pending legacy evidence forces a fenced retry even when the Expo token is unchanged', async () => {
  const calls: unknown[] = [];
  const storage = createInstallationStorage({
    calls,
    generation: 3,
    pendingTokens: ['ExponentPushToken[legacy-token]'],
    registeredUserId: 'account-a',
    storedToken: 'ExponentPushToken[same-token]',
  });

  await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register', input]);
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[same-token]',
    platform: 'ios',
    userId: 'account-a',
  });

  expect(calls).toContainEqual([
    'register',
    {
      expoPushToken: 'ExponentPushToken[same-token]',
      generation: 4,
      installationId,
      installationSecret,
      platform: 'ios',
      previousExpoPushTokens: ['ExponentPushToken[legacy-token]'],
    },
  ]);
  expect(storage.snapshot().pendingTokens).toEqual([]);
});

test('late account A completion cannot overwrite a newer account B registration', async () => {
  const accountAResponse = createDeferred<void>();
  const accountAStarted = createDeferred<void>();
  const calls: unknown[] = [];
  const storage = createInstallationStorage({ calls });

  const accountA = syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register-a', input]);
        accountAStarted.resolve();
        await accountAResponse.promise;
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[account-a-token]',
    platform: 'ios',
    userId: 'account-a',
  });
  await accountAStarted.promise;

  await syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register-b', input]);
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[account-b-token]',
    platform: 'ios',
    userId: 'account-b',
  });

  accountAResponse.resolve();
  await accountA;

  expect(calls).toContainEqual([
    'commit-rejected',
    1,
    'account-a',
    'ExponentPushToken[account-a-token]',
  ]);
  expect(storage.snapshot()).toEqual({
    generation: 2,
    pendingTokens: [],
    registeredUserId: 'account-b',
    storedToken: 'ExponentPushToken[account-b-token]',
  });
});

test('registration cancelled while reading legacy evidence performs no mutation or API call', async () => {
  const pendingRead = createDeferred<void>();
  const pendingReadStarted = createDeferred<void>();
  const calls: unknown[] = [];
  let isCancelled = false;
  const storage = createInstallationStorage({ calls });

  const registration = syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async (input) => {
        calls.push(['register', input]);
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[new-token]',
    getPendingExpoPushTokenCleanupTokens: async () => {
      pendingReadStarted.resolve();
      await pendingRead.promise;
      return ['ExponentPushToken[legacy-token]'];
    },
    isCancelled: () => isCancelled,
    platform: 'ios',
    userId: 'account-a',
  });

  await pendingReadStarted.promise;
  isCancelled = true;
  pendingRead.resolve();
  await registration;

  expect(calls).toEqual([]);
  expect(storage.snapshot().generation).toBe(0);
});

test('registration cancelled during the request preserves evidence and cannot commit locally', async () => {
  const response = createDeferred<void>();
  const started = createDeferred<void>();
  const storage = createInstallationStorage({
    storedToken: 'ExponentPushToken[old-token]',
  });
  let isCancelled = false;

  const registration = syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async () => {
        started.resolve();
        await response.promise;
      },
    },
    ...storage.port,
    expoPushToken: 'ExponentPushToken[new-token]',
    isCancelled: () => isCancelled,
    platform: 'ios',
    userId: 'account-a',
  });

  await started.promise;
  isCancelled = true;
  response.resolve();
  await registration;

  expect(storage.snapshot()).toEqual({
    generation: 1,
    pendingTokens: [
      'ExponentPushToken[old-token]',
      'ExponentPushToken[new-token]',
    ],
    registeredUserId: null,
    storedToken: 'ExponentPushToken[old-token]',
  });
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

function createInstallationStorage(input: {
  calls?: unknown[];
  generation?: number;
  pendingTokens?: string[];
  registeredUserId?: string | null;
  storedToken?: string | null;
} = {}) {
  let generation = input.generation ?? 0;
  let pendingTokens = [...(input.pendingTokens ?? [])];
  let registeredUserId = input.registeredUserId ?? null;
  let storedToken = input.storedToken ?? null;

  return {
    port: {
      beginInstallationMutation: async () => {
        generation += 1;
        input.calls?.push(['begin', generation]);
        return { generation, installationId, installationSecret };
      },
      completeInstallationRegistration: async (
        mutation: { generation: number; installationId: string },
        userId: string,
        expoPushToken: string,
      ) => {
        if (mutation.generation !== generation || mutation.installationId !== installationId) {
          input.calls?.push(['commit-rejected', mutation.generation, userId, expoPushToken]);
          return false;
        }
        registeredUserId = userId;
        storedToken = expoPushToken;
        pendingTokens = [];
        input.calls?.push(['commit', mutation.generation, userId, expoPushToken]);
        return true;
      },
      getInstallationRegistration: async () =>
        generation > 0
          ? { generation, installationId, installationSecret, registeredUserId }
          : null,
      getPendingExpoPushTokenCleanupTokens: async () => [...pendingTokens],
      getStoredExpoPushToken: async () => storedToken,
      setPendingExpoPushTokenCleanup: async (expoPushToken: string) => {
        pendingTokens = [...new Set([...pendingTokens, expoPushToken])];
        input.calls?.push(['pending', expoPushToken]);
      },
    },
    snapshot: () => ({
      generation,
      pendingTokens,
      registeredUserId,
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
