import type { CookieRefreshResponse } from '@web-app-demo/contracts'
import { ApiRequestError } from '@/platform/api'

import type { AuthApi } from './api'

type BootstrapAuthSessionOptions = {
  api: Pick<AuthApi, 'clearSession' | 'refresh'>
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
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      if (shouldApply()) {
        await api.clearSession()
      }
      return
    }

    throw error
  }
}

function refreshBootstrapSession(api: Pick<AuthApi, 'refresh'>) {
  bootstrapRefreshPromise ??= api.refresh().finally(() => {
    bootstrapRefreshPromise = null
  })

  return bootstrapRefreshPromise
}
