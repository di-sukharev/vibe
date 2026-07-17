import type { AuthApiPort, AuthRefreshResponse } from './api';
import type { logoutWithPushCleanup } from './logout';
import { isTerminalAuthFailure } from '@/platform/api';

const bootstrapRefreshPromises = new WeakMap<
  object,
  Promise<AuthRefreshResponse | null>
>();

export function refreshBootstrapSession(api: Pick<AuthApiPort, 'canRefresh' | 'refresh'>) {
  const current = bootstrapRefreshPromises.get(api);
  if (current) return current;

  let refreshPromise!: Promise<AuthRefreshResponse | null>;
  refreshPromise = api
    .canRefresh()
    .then((canRefresh) => {
      if (!canRefresh) return null;
      return api.refresh();
    })
    .finally(() => {
      if (bootstrapRefreshPromises.get(api) === refreshPromise) {
        bootstrapRefreshPromises.delete(api);
      }
    });
  bootstrapRefreshPromises.set(api, refreshPromise);
  return refreshPromise;
}

export async function restoreBootstrapAuthState(
  api: Pick<AuthApiPort, 'canRefresh' | 'refresh'>,
  options: {
    clear: () => Promise<void>;
    getPendingLogout?: () => Promise<boolean>;
    resumePendingLogout?: () => ReturnType<typeof logoutWithPushCleanup>;
  },
): Promise<
  | { status: 'anonymous' }
  | { status: 'authenticated'; response: AuthRefreshResponse }
  | { status: 'retryable-error'; error: unknown }
> {
  try {
    if (options.getPendingLogout && await options.getPendingLogout()) {
      if (!options.resumePendingLogout) {
        throw new Error('Pending logout recovery is unavailable');
      }
      const result = await options.resumePendingLogout();
      if (result.status === 'retryable') {
        return {
          status: 'retryable-error',
          error: new PendingLogoutRetryableError(),
        };
      }
      return { status: 'anonymous' };
    }

    const response = await refreshBootstrapSession(api);
    return response
      ? { status: 'authenticated', response }
      : { status: 'anonymous' };
  } catch (error) {
    if (!isTerminalAuthFailure(error)) {
      return { status: 'retryable-error', error };
    }

    try {
      await options.clear();
      return { status: 'anonymous' };
    } catch (clearError) {
      return { status: 'retryable-error', error: clearError };
    }
  }
}

export class PendingLogoutRetryableError extends Error {
  constructor() {
    super('The pending logout could not reach the server');
  }
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
