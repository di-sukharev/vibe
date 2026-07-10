import type { CookieRefreshResponse } from '@web-app-demo/contracts'

import type { AuthApi } from './api'

type BootstrapAuthSessionOptions = {
  api: Pick<AuthApi, 'expireSession' | 'refresh'>
  shouldApply: () => boolean
  setAccessToken: (accessToken: string | null) => void
}

let bootstrapRefreshPromise: Promise<CookieRefreshResponse> | null = null

export async function bootstrapAuthSession({
  api,
  shouldApply,
  setAccessToken,
}: BootstrapAuthSessionOptions) {
  try {
    const response = await refreshBootstrapSession(api)

    if (shouldApply()) {
      setAccessToken(response.accessToken)
    }
  } catch {
    if (shouldApply()) {
      await api.expireSession()
    }
  }
}

function refreshBootstrapSession(api: Pick<AuthApi, 'refresh'>) {
  bootstrapRefreshPromise ??= api.refresh().finally(() => {
    bootstrapRefreshPromise = null
  })

  return bootstrapRefreshPromise
}
