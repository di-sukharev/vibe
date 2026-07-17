import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  uniqueExpoPushTokens,
  unregisterKnownExpoPushTokens,
} from './push-token-cleanup';
import {
  isSamePushInstallationMutation,
  nextPushInstallationRegistration,
  parsePushInstallationRegistration,
  type PushInstallationMutation,
  type PushInstallationRegistration,
} from './push-installation-state';

const pushTokenKey = 'web_app_demo_expo_push_token';
const pushTokenCleanupKey = 'web_app_demo_expo_push_token_cleanup';
const pushInstallationStateKey = 'web_app_demo_push_installation';
const pushTokenCleanupLimit = 10;
export type { PushInstallationMutation, PushInstallationRegistration };
type PushTokenStorageOperationOptions = {
  isCancelled?: () => boolean;
};
let pushTokenMutationQueue = Promise.resolve();

function runPushTokenMutation<T>(operation: () => Promise<T>) {
  const result = pushTokenMutationQueue.then(operation);
  pushTokenMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function getItem(key: string) {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(key);
  }

  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

async function removeItem(key: string) {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}

export async function getStoredExpoPushToken() {
  return getItem(pushTokenKey);
}

export async function getPushInstallationRegistration() {
  return runPushTokenMutation(() => readPushInstallationState());
}

export async function beginPushInstallationMutation(): Promise<PushInstallationMutation> {
  return runPushTokenMutation(async () => {
    const current = await readPushInstallationState();
    const next = nextPushInstallationRegistration(
      current,
      createInstallationId,
      createInstallationSecret,
    );
    await setItem(pushInstallationStateKey, JSON.stringify(next));
    return {
      generation: next.generation,
      installationId: next.installationId,
      installationSecret: next.installationSecret,
    };
  });
}

export async function commitPushInstallationRegistration(
  mutation: PushInstallationMutation,
  registeredUserId: string,
  expoPushToken: string,
) {
  return runPushTokenMutation(async () => {
    const current = await readPushInstallationState();
    if (!isSamePushInstallationMutation(current, mutation)) return false;
    if (!current) return false;

    await setItem(pushTokenKey, expoPushToken);
    await setItem(pushInstallationStateKey, JSON.stringify({
      ...current,
      registeredUserId,
    } satisfies PushInstallationRegistration));
    await removeItem(pushTokenCleanupKey);
    return true;
  });
}

export async function commitPushInstallationDeactivation(
  mutation: PushInstallationMutation,
) {
  return runPushTokenMutation(async () => {
    const current = await readPushInstallationState();
    if (!isSamePushInstallationMutation(current, mutation)) return false;
    if (!current) return false;

    await removeItem(pushTokenKey);
    await setItem(pushInstallationStateKey, JSON.stringify({
      ...current,
      registeredUserId: null,
    } satisfies PushInstallationRegistration));
    await removeItem(pushTokenCleanupKey);
    return true;
  });
}

export async function clearStoredExpoPushTokenForMutation(
  mutation: PushInstallationMutation,
) {
  return runPushTokenMutation(async () => {
    const current = await readPushInstallationState();
    if (!isSamePushInstallationMutation(current, mutation)) return false;
    await removeItem(pushTokenKey);
    return true;
  });
}

export async function setStoredExpoPushToken(expoPushToken: string) {
  await runPushTokenMutation(() => setItem(pushTokenKey, expoPushToken));
}

export async function clearStoredExpoPushToken() {
  await runPushTokenMutation(() => removeItem(pushTokenKey));
}

export async function getPendingExpoPushTokenCleanup() {
  return (await getPendingExpoPushTokenCleanupTokens())[0] ?? null;
}

export async function setPendingExpoPushTokenCleanup(
  expoPushToken: string,
  options: PushTokenStorageOperationOptions = {},
) {
  await runPushTokenMutation(async () => {
    if (options.isCancelled?.()) return;
    const tokens = uniqueExpoPushTokens([
      ...(await getPendingExpoPushTokenCleanupTokens()),
      expoPushToken,
    ]).slice(-pushTokenCleanupLimit);
    if (options.isCancelled?.()) return;
    await setItem(pushTokenCleanupKey, JSON.stringify(tokens));
  });
}

export async function clearPendingExpoPushTokenCleanup(
  expoPushToken?: string,
  options: PushTokenStorageOperationOptions = {},
) {
  await runPushTokenMutation(async () => {
    if (options.isCancelled?.()) return;
    if (!expoPushToken) {
      await removeItem(pushTokenCleanupKey);
      return;
    }

    const tokens = (await getPendingExpoPushTokenCleanupTokens())
      .filter((token) => token !== expoPushToken);
    if (options.isCancelled?.()) return;
    if (tokens.length === 0) {
      await removeItem(pushTokenCleanupKey);
      return;
    }

    await setItem(pushTokenCleanupKey, JSON.stringify(tokens));
  });
}

export async function getPendingExpoPushTokenCleanupTokens() {
  const value = await getItem(pushTokenCleanupKey);
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return uniqueExpoPushTokens(
        parsed.filter((token): token is string => typeof token === 'string'),
      ).slice(-pushTokenCleanupLimit);
    }
  } catch {
    return [value];
  }

  return typeof value === 'string' ? [value] : [];
}

export async function getKnownExpoPushTokens() {
  return uniqueExpoPushTokens([
    await getStoredExpoPushToken(),
    ...(await getPendingExpoPushTokenCleanupTokens()),
  ]);
}

export async function markStoredExpoPushTokenForCleanup(
  options: PushTokenStorageOperationOptions = {},
) {
  await runPushTokenMutation(async () => {
    if (options.isCancelled?.()) return;
    const storedToken = await getItem(pushTokenKey);
    if (!storedToken || options.isCancelled?.()) return;

    const tokens = uniqueExpoPushTokens([
      ...(await getPendingExpoPushTokenCleanupTokens()),
      storedToken,
    ]).slice(-pushTokenCleanupLimit);
    if (options.isCancelled?.()) return;
    await setItem(pushTokenCleanupKey, JSON.stringify(tokens));
    await removeItem(pushTokenKey);
  });
}

export async function unregisterStoredExpoPushToken(api: {
  unregisterExpoPushToken: (
    input: {
      expoPushTokens?: string[];
      generation: number;
      installationId: string;
      installationSecret: string;
    },
    options?: { retryOnUnauthorized?: boolean },
  ) => Promise<{ applied: boolean; ok: true }>;
}, options: {
  clearStoredOnFailure?: boolean;
  isCancelled?: () => boolean;
  retryOnUnauthorized?: boolean;
} = {}) {
  await unregisterKnownExpoPushTokens({
    api,
    beginInstallationMutation: beginPushInstallationMutation,
    clearStoredExpoPushTokenForMutation,
    clearStoredOnFailure: options.clearStoredOnFailure,
    commitInstallationDeactivation: commitPushInstallationDeactivation,
    isCancelled: options.isCancelled,
    retryOnUnauthorized: options.retryOnUnauthorized,
    storage: {
      clearPendingExpoPushTokenCleanup: (expoPushToken) =>
        clearPendingExpoPushTokenCleanup(expoPushToken, {
          isCancelled: options.isCancelled,
        }),
      clearStoredExpoPushToken,
      getPendingExpoPushTokenCleanupTokens,
      getStoredExpoPushToken,
      setPendingExpoPushTokenCleanup: (expoPushToken) =>
        setPendingExpoPushTokenCleanup(expoPushToken, {
          isCancelled: options.isCancelled,
        }),
    },
  });
}

async function readPushInstallationState(): Promise<PushInstallationRegistration | null> {
  return parsePushInstallationRegistration(await getItem(pushInstallationStateKey));
}

function createInstallationId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== 'function') {
    throw new Error('Secure random UUID generation is unavailable');
  }
  return randomUUID.call(globalThis.crypto);
}

function createInstallationSecret() {
  return createInstallationId();
}
