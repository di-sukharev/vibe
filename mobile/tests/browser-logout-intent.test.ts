import { expect, test } from 'bun:test';

import {
  clearPendingBrowserLogout,
  getPendingBrowserLogout,
  markPendingBrowserLogout,
  pendingLogoutStorageKey,
} from '../src/features/auth/browser-logout-intent';

test('a newer authenticated browser epoch supersedes an older durable logout intent', () => {
  const storage = createStorage();

  markPendingBrowserLogout(storage, 4);
  expect(getPendingBrowserLogout(storage, 4)).toBe(true);
  expect(getPendingBrowserLogout(storage, 5)).toBe(false);
  expect(storage.getItem(pendingLogoutStorageKey)).toBeNull();
});

test('an old logout completion cannot clear a newer epoch intent', () => {
  const storage = createStorage();

  markPendingBrowserLogout(storage, 4);
  markPendingBrowserLogout(storage, 6);
  clearPendingBrowserLogout(storage, 4);

  expect(getPendingBrowserLogout(storage, 6)).toBe(true);
  clearPendingBrowserLogout(storage, 6);
  expect(storage.getItem(pendingLogoutStorageKey)).toBeNull();
});

test('legacy browser logout intents remain recoverable during the storage upgrade', () => {
  const storage = createStorage();
  storage.setItem(pendingLogoutStorageKey, 'pending-v1');

  expect(getPendingBrowserLogout(storage, 9)).toBe(true);
  clearPendingBrowserLogout(storage);
  expect(storage.getItem(pendingLogoutStorageKey)).toBeNull();
});

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
