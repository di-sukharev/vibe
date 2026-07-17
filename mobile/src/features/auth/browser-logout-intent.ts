type BrowserLogoutIntentStorage = {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
};

export const pendingLogoutStorageKey = 'web_app_demo_pending_logout';
const legacyPendingLogoutValue = 'pending-v1';
const epochPendingLogoutPrefix = 'pending-v2:';

export function getPendingBrowserLogout(
  storage: BrowserLogoutIntentStorage,
  currentBrowserSessionEpoch: number,
) {
  const value = storage.getItem(pendingLogoutStorageKey);
  if (value === legacyPendingLogoutValue) return true;

  const storedEpoch = epochFromPendingLogoutValue(value);
  if (storedEpoch === null || storedEpoch >= currentBrowserSessionEpoch) {
    return storedEpoch !== null;
  }

  if (value !== null) {
    removePendingLogoutValue(storage, value);
  }
  return false;
}

export function markPendingBrowserLogout(
  storage: BrowserLogoutIntentStorage,
  browserSessionEpoch: number,
) {
  storage.setItem(
    pendingLogoutStorageKey,
    pendingLogoutValue(browserSessionEpoch),
  );
}

export function clearPendingBrowserLogout(
  storage: BrowserLogoutIntentStorage,
  browserSessionEpoch?: number,
) {
  const expectedValue = browserSessionEpoch === undefined
    ? legacyPendingLogoutValue
    : pendingLogoutValue(browserSessionEpoch);
  removePendingLogoutValue(storage, expectedValue);
}

function pendingLogoutValue(browserSessionEpoch: number) {
  if (!Number.isSafeInteger(browserSessionEpoch) || browserSessionEpoch < 0) {
    throw new Error('A valid browser session epoch is required for durable logout');
  }
  return `${epochPendingLogoutPrefix}${browserSessionEpoch}`;
}

function epochFromPendingLogoutValue(value: string | null) {
  if (!value?.startsWith(epochPendingLogoutPrefix)) return null;
  const epoch = Number(value.slice(epochPendingLogoutPrefix.length));
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
}

function removePendingLogoutValue(
  storage: BrowserLogoutIntentStorage,
  expectedValue: string,
) {
  if (storage.getItem(pendingLogoutStorageKey) === expectedValue) {
    storage.removeItem(pendingLogoutStorageKey);
  }
}
