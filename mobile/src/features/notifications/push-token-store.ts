import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  uniqueExpoPushTokens,
  unregisterKnownExpoPushTokens,
} from './push-token-cleanup';

const pushTokenKey = 'web_app_demo_expo_push_token';
const pushTokenCleanupKey = 'web_app_demo_expo_push_token_cleanup';
const pushTokenCleanupLimit = 10;

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

export async function setStoredExpoPushToken(expoPushToken: string) {
  await setItem(pushTokenKey, expoPushToken);
}

export async function clearStoredExpoPushToken() {
  await removeItem(pushTokenKey);
}

export async function getPendingExpoPushTokenCleanup() {
  return (await getPendingExpoPushTokenCleanupTokens())[0] ?? null;
}

export async function setPendingExpoPushTokenCleanup(expoPushToken: string) {
  const tokens = uniqueExpoPushTokens([
    ...(await getPendingExpoPushTokenCleanupTokens()),
    expoPushToken,
  ]).slice(-pushTokenCleanupLimit);
  await setItem(pushTokenCleanupKey, JSON.stringify(tokens));
}

export async function clearPendingExpoPushTokenCleanup(expoPushToken?: string) {
  if (!expoPushToken) {
    await removeItem(pushTokenCleanupKey);
    return;
  }

  const tokens = (await getPendingExpoPushTokenCleanupTokens()).filter((token) => token !== expoPushToken);
  if (tokens.length === 0) {
    await removeItem(pushTokenCleanupKey);
    return;
  }

  await setItem(pushTokenCleanupKey, JSON.stringify(tokens));
}

export async function getPendingExpoPushTokenCleanupTokens() {
  const value = await getItem(pushTokenCleanupKey);
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return uniqueExpoPushTokens(parsed.filter((token): token is string => typeof token === 'string'));
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

export async function markStoredExpoPushTokenForCleanup() {
  const storedToken = await getStoredExpoPushToken();
  if (!storedToken) return;

  await setPendingExpoPushTokenCleanup(storedToken);
  await clearStoredExpoPushToken();
}

export async function unregisterStoredExpoPushToken(api: {
  unregisterExpoPushToken: (
    input?: { expoPushToken?: string },
    options?: { retryOnUnauthorized?: boolean },
  ) => Promise<unknown>;
}, options: { clearStoredOnFailure?: boolean; retryOnUnauthorized?: boolean } = {}) {
  await unregisterKnownExpoPushTokens({
    api,
    clearStoredOnFailure: options.clearStoredOnFailure,
    retryOnUnauthorized: options.retryOnUnauthorized,
    storage: {
      clearPendingExpoPushTokenCleanup,
      clearStoredExpoPushToken,
      getPendingExpoPushTokenCleanupTokens,
      getStoredExpoPushToken,
      setPendingExpoPushTokenCleanup,
    },
  });
}
