import type { RegisterPushTokenRequest } from '@web-app-demo/contracts';

export type PushInstallationMutation = {
  generation: number;
  installationId: string;
  installationSecret: string;
};

export type PushInstallationRegistration = PushInstallationMutation & {
  registeredUserId: string | null;
};

export type PushRegistrationApi = {
  registerExpoPushToken: (input: RegisterPushTokenRequest) => Promise<unknown>;
};

type SyncExpoPushTokenRegistrationInput = {
  api: PushRegistrationApi;
  beginInstallationMutation: () => Promise<PushInstallationMutation>;
  completeInstallationRegistration: (
    mutation: PushInstallationMutation,
    userId: string,
    expoPushToken: string,
  ) => Promise<boolean>;
  expoPushToken: string;
  forceRevalidation?: boolean;
  getInstallationRegistration: () => Promise<PushInstallationRegistration | null>;
  getPendingExpoPushTokenCleanupTokens: () => Promise<string[]>;
  getStoredExpoPushToken: () => Promise<string | null>;
  isCancelled?: () => boolean;
  platform: RegisterPushTokenRequest['platform'];
  setPendingExpoPushTokenCleanup: (expoPushToken: string) => Promise<void>;
  userId: string;
};

export async function syncExpoPushTokenRegistration(input: SyncExpoPushTokenRegistrationInput) {
  if (isRegistrationCancelled(input)) return;
  const [installation, pendingTokens, storedToken] = await Promise.all([
    input.getInstallationRegistration(),
    input.getPendingExpoPushTokenCleanupTokens(),
    input.getStoredExpoPushToken(),
  ]);
  if (isRegistrationCancelled(input)) return;

  if (
    installation?.registeredUserId === input.userId &&
    storedToken === input.expoPushToken &&
    pendingTokens.length === 0 &&
    !input.forceRevalidation
  ) {
    return {
      changed: false,
      previousToken: storedToken,
    };
  }

  const mutation = await input.beginInstallationMutation();
  if (isRegistrationCancelled(input)) {
    return {
      changed: false,
      previousToken: storedToken,
    };
  }

  const knownTokens = uniqueExpoPushTokens([
    storedToken,
    ...pendingTokens,
    input.expoPushToken,
  ]);
  for (const token of knownTokens) {
    await input.setPendingExpoPushTokenCleanup(token);
    if (isRegistrationCancelled(input)) {
      return {
        changed: false,
        previousToken: storedToken,
      };
    }
  }

  await input.api.registerExpoPushToken({
    expoPushToken: input.expoPushToken,
    generation: mutation.generation,
    installationId: mutation.installationId,
    installationSecret: mutation.installationSecret,
    platform: input.platform,
    previousExpoPushTokens: knownTokens.filter((token) => token !== input.expoPushToken),
  });

  if (isRegistrationCancelled(input)) {
    return {
      changed: true,
      previousToken: storedToken,
    };
  }

  await input.completeInstallationRegistration(
    mutation,
    input.userId,
    input.expoPushToken,
  );

  return {
    changed: true,
    previousToken: storedToken,
  };
}

function isRegistrationCancelled(input: Pick<SyncExpoPushTokenRegistrationInput, 'isCancelled'>) {
  return input.isCancelled?.() ?? false;
}

function uniqueExpoPushTokens(tokens: (string | null | undefined)[]) {
  return [...new Set(tokens.filter((token): token is string => Boolean(token)))];
}

export async function cleanupExpoPushRegistrationAfterPermissionDenied(input: {
  isCancelled?: () => boolean;
  unregisterStoredExpoPushToken: () => Promise<unknown>;
}) {
  if (input.isCancelled?.()) return;
  await input.unregisterStoredExpoPushToken().catch(() => undefined);
}
