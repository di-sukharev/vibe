export type BrowserAuthCoordinator = <T>(mutation: () => Promise<T>) => Promise<T>

const browserAuthLockName = 'web_app_demo:auth-cookie-mutation'

export const coordinateBrowserAuthMutation: BrowserAuthCoordinator = async (mutation) => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return mutation()

  return locks.request(browserAuthLockName, { mode: 'exclusive' }, mutation)
}
