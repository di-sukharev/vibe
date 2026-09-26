export type BrowserAuthCoordinator = <T>(mutation: () => Promise<T>) => Promise<T>;

type BrowserLockManager = {
  request: <T>(
    name: string,
    options: { mode: 'exclusive' },
    mutation: () => Promise<T>,
  ) => Promise<T>;
};

const browserAuthLockName = 'web_app_demo:auth-cookie-mutation';

/**
 * Serializes cookie auth mutations (login, refresh, logout) across every tab through Web Locks.
 *
 * Web Locks exist only in secure contexts, so plain http on a LAN address, like an old browser,
 * has none. There the mutations are serialized within this tab only. The cross-tab lock is an
 * optimization, not a security boundary: the server enforces refresh rotation, the reuse grace
 * window, and the logout fence either way.
 */
export function createBrowserAuthCoordinator(
  getLockManager: () => BrowserLockManager | undefined = currentBrowserLockManager,
): BrowserAuthCoordinator {
  let inProcessTail = Promise.resolve();

  return async <T>(mutation: () => Promise<T>) => {
    const locks = getLockManager();
    if (locks) {
      return locks.request(browserAuthLockName, { mode: 'exclusive' }, mutation);
    }

    const result = inProcessTail.then(mutation);
    inProcessTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export const coordinateBrowserAuthMutation = createBrowserAuthCoordinator();

function currentBrowserLockManager() {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { locks?: BrowserLockManager }).locks;
}
