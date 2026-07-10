import type { TokenRefreshResponse } from '@web-app-demo/contracts';

import type { AuthApiPort } from './api';

let bootstrapRefreshPromise: Promise<TokenRefreshResponse | null> | null = null;

export function refreshBootstrapSession(
  api: Pick<AuthApiPort, 'refresh'>,
  getStoredRefreshToken: () => Promise<string | null>,
) {
  bootstrapRefreshPromise ??= getStoredRefreshToken()
    .then((refreshToken) => {
      if (!refreshToken) return null;
      return api.refresh();
    })
    .finally(() => {
      bootstrapRefreshPromise = null;
    });

  return bootstrapRefreshPromise;
}

export async function clearBootstrapAuthState(options: {
  clearStoredExpoPushToken: () => Promise<void>;
  clearStoredRefreshToken: () => Promise<void>;
  markStoredExpoPushTokenForCleanup?: () => Promise<void>;
  setAccessToken: (accessToken: string | null) => void;
}) {
  options.setAccessToken(null);
  if (options.markStoredExpoPushTokenForCleanup) {
    await options.markStoredExpoPushTokenForCleanup().catch(() => undefined);
  } else {
    await options.clearStoredExpoPushToken().catch(() => undefined);
  }
  await options.clearStoredRefreshToken();
}
