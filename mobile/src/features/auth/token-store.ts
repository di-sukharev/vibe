import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  clearPendingBrowserLogout,
  getPendingBrowserLogout,
  markPendingBrowserLogout,
  pendingLogoutStorageKey,
} from './browser-logout-intent';
import { browserSessionCoordinator } from './browser-session-coordinator';

const refreshTokenKey = 'web_app_demo_refresh_token';
const pendingLogoutValue = 'pending-v1';

export async function getStoredRefreshToken() {
  if (Platform.OS === 'web') return null;

  return SecureStore.getItemAsync(refreshTokenKey);
}

export async function setStoredRefreshToken(refreshToken: string) {
  if (Platform.OS === 'web') return;

  await SecureStore.setItemAsync(refreshTokenKey, refreshToken);
}

export async function clearStoredRefreshToken() {
  if (Platform.OS === 'web') return;

  await SecureStore.deleteItemAsync(refreshTokenKey);
}

export async function getPendingLogout() {
  if (Platform.OS === 'web') {
    return getPendingBrowserLogout(
      browserStorage(),
      browserSessionCoordinator.current().epoch,
    );
  }

  return (await SecureStore.getItemAsync(pendingLogoutStorageKey)) === pendingLogoutValue;
}

export async function markPendingLogout(browserSessionEpoch?: number) {
  if (Platform.OS === 'web') {
    if (browserSessionEpoch === undefined) {
      throw new Error('Browser logout intent is missing its session epoch');
    }
    markPendingBrowserLogout(browserStorage(), browserSessionEpoch);
    return;
  }

  await SecureStore.setItemAsync(pendingLogoutStorageKey, pendingLogoutValue);
}

export async function clearPendingLogout(browserSessionEpoch?: number) {
  if (Platform.OS === 'web') {
    clearPendingBrowserLogout(browserStorage(), browserSessionEpoch);
    return;
  }

  await SecureStore.deleteItemAsync(pendingLogoutStorageKey);
}

function browserStorage() {
  const storage = globalThis.localStorage;
  if (!storage) {
    throw new Error('Durable browser storage is unavailable');
  }
  return storage;
}
