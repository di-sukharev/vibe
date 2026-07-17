import type { PushMutationResponse, UnregisterPushTokenRequest } from '@web-app-demo/contracts';

type ModernUnregisterPushTokenRequest = Extract<
  UnregisterPushTokenRequest,
  { installationId: string }
>;

export type PushInstallationMutation = {
  generation: number;
  installationId: string;
  installationSecret: string;
};

export type PushTokenCleanupApi = {
  unregisterExpoPushToken: (
    input: ModernUnregisterPushTokenRequest,
    options?: { retryOnUnauthorized?: boolean },
  ) => Promise<PushMutationResponse>;
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
  beginInstallationMutation: () => Promise<PushInstallationMutation>;
  clearStoredExpoPushTokenForMutation?: (
    mutation: PushInstallationMutation,
  ) => Promise<boolean>;
  clearStoredOnFailure?: boolean;
  commitInstallationDeactivation: (
    mutation: PushInstallationMutation,
  ) => Promise<boolean>;
  isCancelled?: () => boolean;
  retryOnUnauthorized?: boolean;
  storage: PushTokenCleanupStorage;
}) {
  if (input.isCancelled?.()) return;
  const storedToken = await input.storage.getStoredExpoPushToken();
  if (input.isCancelled?.()) return;
  const pendingTokens = await input.storage.getPendingExpoPushTokenCleanupTokens();
  if (input.isCancelled?.()) return;
  const tokens = uniqueExpoPushTokens([storedToken, ...pendingTokens]);
  if (tokens.length === 0) return;

  const mutation = await input.beginInstallationMutation();
  if (input.isCancelled?.()) return;
  for (const token of tokens) {
    await input.storage.setPendingExpoPushTokenCleanup(token);
    if (input.isCancelled?.()) return;
  }

  try {
    const response = await input.api.unregisterExpoPushToken(
      {
        expoPushTokens: tokens,
        generation: mutation.generation,
        installationId: mutation.installationId,
        installationSecret: mutation.installationSecret,
      },
      { retryOnUnauthorized: input.retryOnUnauthorized },
    );
    if (input.isCancelled?.() || !response.applied) return;
    await input.commitInstallationDeactivation(mutation);
  } catch (error) {
    if (input.isCancelled?.()) return;
    if (input.clearStoredOnFailure && storedToken) {
      await input.storage.setPendingExpoPushTokenCleanup(storedToken);
      if (input.isCancelled?.()) return;
      await input.clearStoredExpoPushTokenForMutation?.(mutation);
    }
    throw error;
  }
}

export function uniqueExpoPushTokens(tokens: (string | null | undefined)[]) {
  return [...new Set(tokens.filter((token): token is string => Boolean(token)))];
}
