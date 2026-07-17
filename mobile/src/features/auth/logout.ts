import type { TokenLogoutRequest } from '@web-app-demo/contracts';

import type { AuthApiPort } from './api';

type LogoutRequestInput = Omit<TokenLogoutRequest, 'refreshToken'> & {
  refreshToken?: string;
};

const defaultServerLogoutTimeoutMs = 2_000;
const defaultExpiredSessionPushCleanupTimeoutMs = 2_000;

export function createLogoutOperationCoordinator() {
  let inFlight: Promise<void> | null = null;

  return {
    run(operation: () => Promise<void>) {
      if (inFlight) return inFlight;

      try {
        inFlight = operation();
      } catch (error) {
        inFlight = Promise.reject(error);
      }
      const current = inFlight;
      void current.then(
        () => {
          if (inFlight === current) inFlight = null;
        },
        () => {
          if (inFlight === current) inFlight = null;
        },
      );
      return current;
    },
  };
}

export type LogoutPushCleanupInput = {
  authApi: Pick<AuthApiPort, 'canRefresh' | 'prepareLogout'>;
  clearLocalSession: () => Promise<void>;
  clearPendingExpoPushTokenCleanup: () => Promise<void>;
  clearStoredExpoPushToken: () => Promise<void>;
  completePendingLogout: (browserSessionEpoch?: number) => Promise<void>;
  drainPushRegistrations: () => Promise<void>;
  getKnownExpoPushTokens: () => Promise<string[]>;
  getStoredExpoPushToken: () => Promise<string | null>;
  getStoredRefreshToken: () => Promise<string | null>;
  markPendingLogout: (browserSessionEpoch?: number) => Promise<void>;
  sessionGeneration: number;
  serverLogoutTimeoutMs?: number;
  setPendingExpoPushTokenCleanup: (expoPushToken: string) => Promise<void>;
};

export type ExpiredSessionPushCleanupInput = {
  drainPushRegistrations: () => Promise<void>;
  isCancelled: () => boolean;
  markStoredExpoPushTokenForCleanup: (options?: {
    isCancelled?: () => boolean;
  }) => Promise<void>;
};

export async function preserveExpiredSessionPushEvidence(
  input: ExpiredSessionPushCleanupInput,
  timeoutMs = defaultExpiredSessionPushCleanupTimeoutMs,
) {
  await settleOperationWithin((async () => {
    await input.drainPushRegistrations().catch(() => undefined);
    if (input.isCancelled()) return;
    await input.markStoredExpoPushTokenForCleanup({
      isCancelled: input.isCancelled,
    }).catch(() => undefined);
  })(), timeoutMs);
}

export async function logoutWithPushCleanup(input: LogoutPushCleanupInput) {
  const serverLogout = input.authApi.prepareLogout(input.sessionGeneration);
  const browserSessionEpoch = serverLogout.browserSessionEpoch;
  await input.markPendingLogout(browserSessionEpoch);
  await input.clearLocalSession();
  const storedExpoPushToken = await input.getStoredExpoPushToken().catch(() => null);
  const initiallyKnownExpoPushTokens = await input.getKnownExpoPushTokens().catch(() =>
    storedExpoPushToken ? [storedExpoPushToken] : [],
  );
  const refreshToken = await input.getStoredRefreshToken().catch(() => null);
  await input.drainPushRegistrations().catch(() => undefined);
  const knownExpoPushTokens = uniqueTokens([
    ...initiallyKnownExpoPushTokens,
    ...await input.getKnownExpoPushTokens().catch(() => []),
  ]);

  const logoutPayload: LogoutRequestInput = {
    expoPushToken: storedExpoPushToken ?? undefined,
    expoPushTokens: knownExpoPushTokens,
    refreshToken: refreshToken ?? undefined,
  };
  const logoutAbortController = new AbortController();

  let status: 'retryable' | 'revoked' | 'stale';
  try {
    status =
      refreshToken === null && !await input.authApi.canRefresh()
        ? 'stale'
        : await settleServerLogoutWithin(
          Promise.resolve().then(() =>
            serverLogout(
              logoutPayload,
              logoutAbortController.signal,
            ),
          ),
          input.serverLogoutTimeoutMs ?? defaultServerLogoutTimeoutMs,
          () => logoutAbortController.abort(
            new Error('Server logout timed out'),
          ),
        );
  } catch {
    status = 'retryable';
  }
  const sessionRevoked = status === 'revoked';

  if (knownExpoPushTokens.length === 0 || sessionRevoked) {
    await input.clearStoredExpoPushToken().catch(() => undefined);
    await input.clearPendingExpoPushTokenCleanup().catch(() => undefined);
  } else {
    await Promise.all(
      knownExpoPushTokens.map((token) =>
        input.setPendingExpoPushTokenCleanup(token).catch(() => undefined)),
    );
    await input.clearStoredExpoPushToken().catch(() => undefined);
  }

  if (status !== 'retryable') {
    try {
      await input.completePendingLogout(browserSessionEpoch);
    } catch {
      return { sessionRevoked, status: 'retryable' as const };
    }
  }

  return { sessionRevoked, status };
}

function uniqueTokens(tokens: string[]) {
  return [...new Set(tokens.filter(Boolean))];
}

function settleServerLogoutWithin(
  operation: Promise<boolean>,
  timeoutMs: number,
  onTimeout: () => void,
) {
  return new Promise<'retryable' | 'revoked' | 'stale'>((resolve) => {
    let settled = false;
    const settle = (status: 'retryable' | 'revoked' | 'stale') => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(status);
    };
    const timeout = setTimeout(() => {
      onTimeout();
      settle('retryable');
    }, Math.max(0, timeoutMs));

    void operation.then(
      (sessionRevoked) => settle(sessionRevoked ? 'revoked' : 'stale'),
      () => settle('retryable'),
    );
  });
}

function settleOperationWithin(operation: Promise<unknown>, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(settle, Math.max(0, timeoutMs));
    void operation.then(settle, settle);
  });
}
