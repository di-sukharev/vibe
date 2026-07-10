import type { AuthApiPort, AuthRefreshResponse } from './api';

let bootstrapRefreshPromise: Promise<AuthRefreshResponse | null> | null = null;

export function refreshBootstrapSession(api: Pick<AuthApiPort, 'canRefresh' | 'refresh'>) {
  bootstrapRefreshPromise ??= api
    .canRefresh()
    .then((canRefresh) => {
      if (!canRefresh) return null;
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
