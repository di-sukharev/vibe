import type { TokenLogoutRequest } from '@web-app-demo/contracts';

import type { ApiClient } from './api';

type LogoutRequestInput = Omit<TokenLogoutRequest, 'refreshToken'> & {
  refreshToken?: string;
};

type LogoutPushCleanupInput = {
  api: Pick<ApiClient, 'logout' | 'unregisterExpoPushToken'>;
  clearPendingExpoPushTokenCleanup: () => Promise<void>;
  clearStoredExpoPushToken: () => Promise<void>;
  getKnownExpoPushTokens: () => Promise<string[]>;
  getStoredExpoPushToken: () => Promise<string | null>;
  getStoredRefreshToken: () => Promise<string | null>;
  setPendingExpoPushTokenCleanup: (expoPushToken: string) => Promise<void>;
  unregisterStoredExpoPushToken: (
    api: Pick<ApiClient, 'unregisterExpoPushToken'>,
    options?: { clearStoredOnFailure?: boolean; retryOnUnauthorized?: boolean },
  ) => Promise<void>;
};

export async function logoutWithPushCleanup(input: LogoutPushCleanupInput) {
  const storedExpoPushToken = await input.getStoredExpoPushToken().catch(() => null);
  const knownExpoPushTokens = await input.getKnownExpoPushTokens().catch(() =>
    storedExpoPushToken ? [storedExpoPushToken] : [],
  );
  const refreshToken = await input.getStoredRefreshToken().catch(() => null);

  const accessCleanupSucceeded = await input
    .unregisterStoredExpoPushToken(input.api, {
      clearStoredOnFailure: true,
      retryOnUnauthorized: false,
    })
    .then(() => true)
    .catch(() => false);

  const logoutPayload: LogoutRequestInput = {
    expoPushToken: storedExpoPushToken ?? undefined,
    expoPushTokens: knownExpoPushTokens,
    refreshToken: refreshToken ?? undefined,
  };
  const sessionRevoked = await input.api.logout(logoutPayload).catch(() => false);

  if (knownExpoPushTokens.length === 0 || accessCleanupSucceeded || sessionRevoked) {
    await input.clearStoredExpoPushToken().catch(() => undefined);
    await input.clearPendingExpoPushTokenCleanup().catch(() => undefined);
    return;
  }

  await Promise.all(
    knownExpoPushTokens.map((token) => input.setPendingExpoPushTokenCleanup(token).catch(() => undefined)),
  );
  await input.clearStoredExpoPushToken().catch(() => undefined);
}
