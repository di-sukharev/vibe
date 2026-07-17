import type { TokenLogoutRequest } from '@web-app-demo/contracts';
import { expect, test } from 'bun:test';

import { createLogoutOperationCoordinator, logoutWithPushCleanup } from '../src/features/auth/logout';
import { syncExpoPushTokenRegistration } from '../src/features/notifications/push-registration';

const durableLogoutIntentNoop = {
  completePendingLogout: async () => undefined,
  markPendingLogout: async () => undefined,
};

test('logout coordinator shares one in-flight operation across rapid repeated calls', async () => {
  const coordinator = createLogoutOperationCoordinator();
  let operationCalls = 0;
  let finishOperation: (() => void) | null = null;

  const first = coordinator.run(() => {
    operationCalls += 1;
    return new Promise<void>((resolve) => {
      finishOperation = resolve;
    });
  });
  const second = coordinator.run(async () => {
    operationCalls += 1;
  });

  expect(first).toBe(second);
  expect(operationCalls).toBe(1);

  finishOperation?.();
  await first;

  await coordinator.run(async () => {
    operationCalls += 1;
  });
  expect(operationCalls).toBe(2);
});

test('logoutWithPushCleanup forwards the generation that started a delayed server logout', async () => {
  let receivedGeneration: number | undefined;

  await logoutWithPushCleanup({
    ...durableLogoutIntentNoop,
    authApi: preparedAuthApi(
      async (_input, generation) => {
        receivedGeneration = generation;
        return true;
      },
    ),
    clearLocalSession: async () => undefined,
    clearPendingExpoPushTokenCleanup: async () => undefined,
    clearStoredExpoPushToken: async () => undefined,
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [],
    getStoredExpoPushToken: async () => null,
    getStoredRefreshToken: async () => null,
    sessionGeneration: 7,
    setPendingExpoPushTokenCleanup: async () => undefined,
  });

  expect(receivedGeneration).toBe(7);
});

test('logoutWithPushCleanup includes a registration still in flight after the bounded drain', async () => {
  const token = 'ExponentPushToken[in-flight-token]';
  let pendingTokens: string[] = [];
  let registrationCancelled = false;
  let storedToken: string | null = null;
  let logoutPayload: unknown;
  let releaseRegistration: (() => void) | null = null;
  let markRegistrationStarted: (() => void) | null = null;
  const registrationStarted = new Promise<void>((resolve) => {
    markRegistrationStarted = resolve;
  });

  const registration = syncExpoPushTokenRegistration({
    api: {
      registerExpoPushToken: async () => {
        markRegistrationStarted?.();
        await new Promise<void>((resolve) => {
          releaseRegistration = resolve;
        });
      },
    },
    beginInstallationMutation: async () => ({
      generation: 1,
      installationId: '018fd4f2-1f3a-7c88-bc49-333333333333',
      installationSecret: '118fd4f2-1f3a-4c88-bc49-333333333333',
    }),
    completeInstallationRegistration: async (_mutation, _userId, nextToken) => {
      storedToken = nextToken;
      pendingTokens = [];
      return true;
    },
    expoPushToken: token,
    getInstallationRegistration: async () => null,
    getPendingExpoPushTokenCleanupTokens: async () => pendingTokens,
    getStoredExpoPushToken: async () => storedToken,
    isCancelled: () => registrationCancelled,
    platform: 'ios',
    setPendingExpoPushTokenCleanup: async (pendingToken) => {
      pendingTokens = [...new Set([...pendingTokens, pendingToken])];
    },
    userId: 'account-a',
  });

  await registrationStarted;

  await logoutWithPushCleanup({
    ...durableLogoutIntentNoop,
    authApi: preparedAuthApi(
      async (input) => {
        logoutPayload = input;
        releaseRegistration?.();
        await registration;
        return true;
      },
    ),
    clearLocalSession: async () => {
      registrationCancelled = true;
    },
    clearPendingExpoPushTokenCleanup: async () => {
      pendingTokens = [];
    },
    clearStoredExpoPushToken: async () => {
      storedToken = null;
    },
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [...new Set([
      ...(storedToken ? [storedToken] : []),
      ...pendingTokens,
    ])],
    getStoredExpoPushToken: async () => storedToken,
    getStoredRefreshToken: async () => 'r'.repeat(32),
    sessionGeneration: 0,
    setPendingExpoPushTokenCleanup: async (pendingToken) => {
      pendingTokens = [...new Set([...pendingTokens, pendingToken])];
    },
  });

  expect(logoutPayload).toEqual({
    expoPushToken: undefined,
    expoPushTokens: [token],
    refreshToken: 'r'.repeat(32),
  });
  expect(storedToken).toBeNull();
  expect(pendingTokens).toEqual([]);
});

test('logoutWithPushCleanup preserves push cleanup evidence when refresh logout lacks authority', async () => {
  const calls: unknown[] = [];
  let storedCleared = false;
  let pendingCleared = false;

  await logoutWithPushCleanup({
    ...durableLogoutIntentNoop,
    authApi: preparedAuthApi(
      async (input) => {
        calls.push(['logout', input]);
        return false;
      },
    ),
    clearLocalSession: async () => undefined,
    clearPendingExpoPushTokenCleanup: async () => {
      pendingCleared = true;
    },
    clearStoredExpoPushToken: async () => {
      storedCleared = true;
    },
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => ['ExponentPushToken[current-token]'],
    getStoredExpoPushToken: async () => 'ExponentPushToken[current-token]',
    getStoredRefreshToken: async () => 'r'.repeat(32),
    sessionGeneration: 0,
    setPendingExpoPushTokenCleanup: async () => {
      calls.push(['set-pending']);
    },
  });

  expect(calls).toEqual([
    [
      'logout',
      {
        expoPushToken: 'ExponentPushToken[current-token]',
        expoPushTokens: ['ExponentPushToken[current-token]'],
        refreshToken: 'r'.repeat(32),
      },
    ],
    ['set-pending'],
  ]);
  expect(storedCleared).toBe(true);
  expect(pendingCleared).toBe(false);
});

test('logoutWithPushCleanup preserves pending cleanup when access unregister and refresh logout lack authority', async () => {
  const pendingTokens: string[] = [];
  let storedCleared = false;
  let pendingCleared = false;

  await logoutWithPushCleanup({
    ...durableLogoutIntentNoop,
    authApi: preparedAuthApi(async () => false),
    clearLocalSession: async () => undefined,
    clearPendingExpoPushTokenCleanup: async () => {
      pendingCleared = true;
    },
    clearStoredExpoPushToken: async () => {
      storedCleared = true;
    },
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [
      'ExponentPushToken[current-token]',
      'ExponentPushToken[pending-token]',
    ],
    getStoredExpoPushToken: async () => 'ExponentPushToken[current-token]',
    getStoredRefreshToken: async () => 'r'.repeat(32),
    sessionGeneration: 0,
    setPendingExpoPushTokenCleanup: async (token) => {
      pendingTokens.push(token);
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
    ...durableLogoutIntentNoop,
    authApi: preparedAuthApi(
      async (input) => {
        expect(input.refreshToken).toBe('r'.repeat(32));
        return true;
      },
    ),
    clearLocalSession: async () => undefined,
    clearPendingExpoPushTokenCleanup: async () => {
      pendingCleared = true;
    },
    clearStoredExpoPushToken: async () => undefined,
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => ['ExponentPushToken[current-token]'],
    getStoredExpoPushToken: async () => 'ExponentPushToken[current-token]',
    getStoredRefreshToken: async () => 'r'.repeat(32),
    sessionGeneration: 0,
    setPendingExpoPushTokenCleanup: async (token) => {
      pendingTokens.push(token);
    },
  });

  expect(pendingCleared).toBe(true);
  expect(pendingTokens).toEqual([]);
});

test('logoutWithPushCleanup clears local push state and preserves cleanup evidence when server logout is unavailable', async () => {
  let storedCleared = false;
  let localCleared = false;
  const pendingTokens: string[] = [];

  await expect(logoutWithPushCleanup({
    ...durableLogoutIntentNoop,
    authApi: preparedAuthApi(
      async () => {
        expect(localCleared).toBe(true);
        throw new Error('offline');
      },
    ),
    clearLocalSession: async () => {
      localCleared = true;
    },
    clearPendingExpoPushTokenCleanup: async () => undefined,
    clearStoredExpoPushToken: async () => {
      storedCleared = true;
    },
    drainPushRegistrations: async () => {
      expect(localCleared).toBe(true);
    },
    getKnownExpoPushTokens: async () => ['ExponentPushToken[current-token]'],
    getStoredExpoPushToken: async () => 'ExponentPushToken[current-token]',
    getStoredRefreshToken: async () => 'r'.repeat(32),
    sessionGeneration: 0,
    setPendingExpoPushTokenCleanup: async (token) => {
      pendingTokens.push(token);
    },
  })).resolves.toEqual({ sessionRevoked: false, status: 'retryable' });

  expect(storedCleared).toBe(true);
  expect(pendingTokens).toEqual(['ExponentPushToken[current-token]']);
});

test('logoutWithPushCleanup stops waiting when server logout never settles', async () => {
  let localCleared = false;
  let storedCleared = false;
  const pendingTokens: string[] = [];

  const result = await Promise.race([
    logoutWithPushCleanup({
      ...durableLogoutIntentNoop,
      authApi: preparedAuthApi(
        async () => new Promise<boolean>(() => undefined),
      ),
      clearLocalSession: async () => {
        localCleared = true;
      },
      clearPendingExpoPushTokenCleanup: async () => undefined,
      clearStoredExpoPushToken: async () => {
        storedCleared = true;
      },
      drainPushRegistrations: async () => undefined,
      getKnownExpoPushTokens: async () => ['ExponentPushToken[current-token]'],
      getStoredExpoPushToken: async () => 'ExponentPushToken[current-token]',
      getStoredRefreshToken: async () => 'r'.repeat(32),
      sessionGeneration: 0,
      serverLogoutTimeoutMs: 5,
      setPendingExpoPushTokenCleanup: async (token) => {
        pendingTokens.push(token);
      },
    }),
    new Promise<'still-waiting'>((resolve) => {
      setTimeout(() => resolve('still-waiting'), 50);
    }),
  ]);

  expect(result).toEqual({ sessionRevoked: false, status: 'retryable' });
  expect(localCleared).toBe(true);
  expect(storedCleared).toBe(true);
  expect(pendingTokens).toEqual(['ExponentPushToken[current-token]']);
});

test('logoutWithPushCleanup durably records intent before local UI clear and retains authority on timeout', async () => {
  const events: string[] = [];
  let logoutIntentPending = false;
  let refreshToken: string | null = 'r'.repeat(32);

  const result = await logoutWithPushCleanup({
    authApi: preparedAuthApi(
      async () => new Promise<boolean>(() => undefined),
    ),
    clearLocalSession: async () => {
      expect(logoutIntentPending).toBe(true);
      expect(refreshToken).toBe('r'.repeat(32));
      events.push('clear-local');
    },
    clearPendingExpoPushTokenCleanup: async () => undefined,
    clearStoredExpoPushToken: async () => undefined,
    completePendingLogout: async () => {
      events.push('complete-intent');
      refreshToken = null;
      logoutIntentPending = false;
    },
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [],
    getStoredExpoPushToken: async () => null,
    getStoredRefreshToken: async () => refreshToken,
    markPendingLogout: async () => {
      events.push('mark-intent');
      logoutIntentPending = true;
    },
    serverLogoutTimeoutMs: 5,
    sessionGeneration: 1,
    setPendingExpoPushTokenCleanup: async () => undefined,
  });

  expect(result).toEqual({ sessionRevoked: false, status: 'retryable' });
  expect(events).toEqual(['mark-intent', 'clear-local']);
  expect(logoutIntentPending).toBe(true);
  expect(refreshToken).toBe('r'.repeat(32));
});

test('logoutWithPushCleanup terminally clears an orphan marker when native refresh authority is already absent', async () => {
  let logoutCalls = 0;
  let logoutIntentPending = true;

  const result = await logoutWithPushCleanup({
    authApi: preparedAuthApi(
      async () => {
        logoutCalls += 1;
        return false;
      },
      async () => false,
    ),
    clearLocalSession: async () => undefined,
    clearPendingExpoPushTokenCleanup: async () => undefined,
    clearStoredExpoPushToken: async () => undefined,
    completePendingLogout: async () => {
      logoutIntentPending = false;
    },
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [],
    getStoredExpoPushToken: async () => null,
    getStoredRefreshToken: async () => null,
    markPendingLogout: async () => {
      logoutIntentPending = true;
    },
    sessionGeneration: 0,
    setPendingExpoPushTokenCleanup: async () => undefined,
  });

  expect(result).toEqual({ sessionRevoked: false, status: 'stale' });
  expect(logoutCalls).toBe(0);
  expect(logoutIntentPending).toBe(false);
});

test('logoutWithPushCleanup keeps an orphan marker retryable when authority storage cannot be read', async () => {
  let logoutIntentPending = true;
  let completeCalls = 0;

  const result = await logoutWithPushCleanup({
    authApi: preparedAuthApi(
      async () => false,
      async () => {
        throw new Error('secure storage unavailable');
      },
    ),
    clearLocalSession: async () => undefined,
    clearPendingExpoPushTokenCleanup: async () => undefined,
    clearStoredExpoPushToken: async () => undefined,
    completePendingLogout: async () => {
      completeCalls += 1;
      logoutIntentPending = false;
    },
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [],
    getStoredExpoPushToken: async () => null,
    getStoredRefreshToken: async () => {
      throw new Error('secure storage unavailable');
    },
    markPendingLogout: async () => {
      logoutIntentPending = true;
    },
    sessionGeneration: 0,
    setPendingExpoPushTokenCleanup: async () => undefined,
  });

  expect(result).toEqual({ sessionRevoked: false, status: 'retryable' });
  expect(completeCalls).toBe(0);
  expect(logoutIntentPending).toBe(true);
});

test('logoutWithPushCleanup remains retryable when terminal server logout cannot finish local authority cleanup', async () => {
  let logoutIntentPending = true;

  const result = await logoutWithPushCleanup({
    authApi: preparedAuthApi(async () => true),
    clearLocalSession: async () => undefined,
    clearPendingExpoPushTokenCleanup: async () => undefined,
    clearStoredExpoPushToken: async () => undefined,
    completePendingLogout: async () => {
      throw new Error('secure storage unavailable');
    },
    drainPushRegistrations: async () => undefined,
    getKnownExpoPushTokens: async () => [],
    getStoredExpoPushToken: async () => null,
    getStoredRefreshToken: async () => 'r'.repeat(32),
    markPendingLogout: async () => {
      logoutIntentPending = true;
    },
    sessionGeneration: 0,
    setPendingExpoPushTokenCleanup: async () => undefined,
  });

  expect(result).toEqual({ sessionRevoked: true, status: 'retryable' });
  expect(logoutIntentPending).toBe(true);
});

type LogoutRequestInput = Omit<TokenLogoutRequest, 'refreshToken'> & {
  refreshToken?: string;
};

function preparedAuthApi(
  logout: (
    input: LogoutRequestInput,
    generation: number,
    signal?: AbortSignal,
  ) => Promise<boolean>,
  canRefresh: () => Promise<boolean> = async () => true,
) {
  return {
    canRefresh,
    prepareLogout: (generation: number) =>
      (input: LogoutRequestInput = {}, signal?: AbortSignal) =>
        logout(input, generation, signal),
  };
}
