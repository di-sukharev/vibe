import type { RefreshResponse } from '@web-app-demo/contracts'

import type { ApiClient } from './api'

type BootstrapAuthSessionOptions = {
  api: Pick<ApiClient, 'expireSession' | 'refresh'>
  shouldApply: () => boolean
  setAccessToken: (accessToken: string | null) => void
}

let bootstrapRefreshPromise: Promise<RefreshResponse> | null = null

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

function refreshBootstrapSession(api: Pick<ApiClient, 'refresh'>) {
  bootstrapRefreshPromise ??= api.refresh().finally(() => {
    bootstrapRefreshPromise = null
  })

  return bootstrapRefreshPromise
}
