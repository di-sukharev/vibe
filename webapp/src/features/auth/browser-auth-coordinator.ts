export type BrowserAuthCoordinator = <T>(mutation: () => Promise<T>) => Promise<T>

type BrowserLockManager = {
  request: <T>(
    name: string,
    options: { mode: 'exclusive' },
    mutation: () => Promise<T>,
  ) => Promise<T>
}

const browserAuthLockName = 'web_app_demo:auth-cookie-mutation'

export class BrowserAuthLockUnavailableError extends Error {
  readonly code = 'AUTH_BROWSER_LOCK_UNAVAILABLE'

  constructor() {
    super('Cookie authentication requires browser Web Locks support')
  }
}

export function createBrowserAuthCoordinator(
  getLockManager: () => BrowserLockManager | undefined = currentBrowserLockManager,
  isBrowserContext: () => boolean = currentBrowserContext,
): BrowserAuthCoordinator {
  let inProcessTail = Promise.resolve()

  return async <T>(mutation: () => Promise<T>) => {
    const locks = getLockManager()
    if (locks) return locks.request(browserAuthLockName, { mode: 'exclusive' }, mutation)
    if (isBrowserContext()) throw new BrowserAuthLockUnavailableError()

    const result = inProcessTail.then(mutation)
    inProcessTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export const coordinateBrowserAuthMutation = createBrowserAuthCoordinator()

function currentBrowserLockManager() {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { locks?: BrowserLockManager }).locks
}

function currentBrowserContext() {
  return typeof window !== 'undefined'
}
