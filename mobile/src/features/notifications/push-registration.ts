import type { RegisterPushTokenRequest } from '@web-app-demo/contracts';

export type PushRegistrationApi = {
  registerExpoPushToken: (input: RegisterPushTokenRequest) => Promise<unknown>;
  unregisterExpoPushToken: (input?: { expoPushToken?: string }) => Promise<unknown>;
};

type SyncExpoPushTokenRegistrationInput = {
  api: PushRegistrationApi;
  clearPendingExpoPushTokenCleanup?: (expoPushToken?: string) => Promise<void>;
  expoPushToken: string;
  getPendingExpoPushTokenCleanup?: () => Promise<string | null>;
  getPendingExpoPushTokenCleanupTokens?: () => Promise<string[]>;
  getStoredExpoPushToken: () => Promise<string | null>;
  platform: RegisterPushTokenRequest['platform'];
  setPendingExpoPushTokenCleanup?: (expoPushToken: string) => Promise<void>;
  setStoredExpoPushToken: (expoPushToken: string) => Promise<void>;
};

export async function syncExpoPushTokenRegistration(input: SyncExpoPushTokenRegistrationInput) {
  await flushPendingExpoPushTokenCleanup(input);

  const storedToken = await input.getStoredExpoPushToken();
  if (storedToken === input.expoPushToken) {
    return {
      changed: false,
      previousToken: storedToken,
    };
  }

  await input.api.registerExpoPushToken({
    expoPushToken: input.expoPushToken,
    platform: input.platform,
  });

  if (storedToken) {
    await input.setPendingExpoPushTokenCleanup?.(storedToken);
    await unregisterPendingExpoPushTokenCleanup(input, storedToken).catch(() => undefined);
  }

  await input.setStoredExpoPushToken(input.expoPushToken);

  return {
    changed: true,
    previousToken: storedToken,
  };
}

async function flushPendingExpoPushTokenCleanup(input: SyncExpoPushTokenRegistrationInput) {
  const pendingTokens = input.getPendingExpoPushTokenCleanupTokens
    ? await input.getPendingExpoPushTokenCleanupTokens()
    : [await input.getPendingExpoPushTokenCleanup?.()].filter(
        (token): token is string => Boolean(token),
      );

  for (const pendingToken of pendingTokens) {
    if (pendingToken === input.expoPushToken) {
      await input.clearPendingExpoPushTokenCleanup?.(pendingToken);
      continue;
    }

    await unregisterPendingExpoPushTokenCleanup(input, pendingToken).catch(() => undefined);
  }
}

async function unregisterPendingExpoPushTokenCleanup(
  input: SyncExpoPushTokenRegistrationInput,
  expoPushToken: string,
) {
  await input.api.unregisterExpoPushToken({ expoPushToken });
  await input.clearPendingExpoPushTokenCleanup?.(expoPushToken);
}

export async function cleanupExpoPushRegistrationAfterPermissionDenied(input: {
  unregisterStoredExpoPushToken: () => Promise<unknown>;
}) {
  await input.unregisterStoredExpoPushToken().catch(() => undefined);
}
