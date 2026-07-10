export type PushTokenCleanupApi = {
  unregisterExpoPushToken: (
    input?: { expoPushToken?: string },
    options?: { retryOnUnauthorized?: boolean },
  ) => Promise<unknown>;
};

export type PushTokenCleanupStorage = {
  clearPendingExpoPushTokenCleanup: (expoPushToken?: string) => Promise<void>;
  clearStoredExpoPushToken: () => Promise<void>;
  getPendingExpoPushTokenCleanupTokens: () => Promise<string[]>;
  getStoredExpoPushToken: () => Promise<string | null>;
  setPendingExpoPushTokenCleanup: (expoPushToken: string) => Promise<void>;
};

export async function unregisterKnownExpoPushTokens(input: {
  api: PushTokenCleanupApi;
  clearStoredOnFailure?: boolean;
  retryOnUnauthorized?: boolean;
  storage: PushTokenCleanupStorage;
}) {
  const storedToken = await input.storage.getStoredExpoPushToken();
  const tokens = uniqueExpoPushTokens([
    storedToken,
    ...(await input.storage.getPendingExpoPushTokenCleanupTokens()),
  ]);
  if (tokens.length === 0) return;

  let firstError: unknown;

  for (const token of tokens) {
    try {
      await input.api.unregisterExpoPushToken(
        { expoPushToken: token },
        { retryOnUnauthorized: input.retryOnUnauthorized },
      );
      await input.storage.clearPendingExpoPushTokenCleanup(token);
      if (token === storedToken) {
        await input.storage.clearStoredExpoPushToken();
      }
    } catch (error) {
      firstError ??= error;
      await input.storage.setPendingExpoPushTokenCleanup(token);
      if (input.clearStoredOnFailure && token === storedToken) {
        await input.storage.clearStoredExpoPushToken();
      }
    }
  }

  if (firstError) {
    throw firstError;
  }
}

export function uniqueExpoPushTokens(tokens: (string | null | undefined)[]) {
  return [...new Set(tokens.filter((token): token is string => Boolean(token)))];
}
