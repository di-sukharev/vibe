import { useQueryClient } from '@tanstack/react-query'
import type { LoginRequest, RegisterRequest } from '@web-app-demo/contracts'
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { ApiClient } from './api'
import {
  clearAuthenticatedSession,
  useCurrentUserQuery,
  useLoginMutation,
  useLogoutMutation,
  useRegisterMutation,
} from './auth-queries'
import { AuthContext, type AuthContextValue } from './auth-context'
import { bootstrapAuthSession } from './bootstrap-auth'

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [accessToken, setAccessTokenState] = useState<string | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  const setAccessToken = useCallback(
    (nextAccessToken: string | null) => setAccessTokenState(nextAccessToken),
    [],
  )
  const handleAuthExpired = useCallback(() => {
    clearAuthenticatedSession(queryClient, setAccessToken)
  }, [queryClient, setAccessToken])

  const api = useMemo(
    () =>
      new ApiClient({
        getAccessToken: () => accessToken,
        setAccessToken,
        onAuthExpired: handleAuthExpired,
      }),
    [accessToken, handleAuthExpired, setAccessToken],
  )

  useEffect(() => {
    let isMounted = true
    const bootstrapApi = new ApiClient({
      getAccessToken: () => null,
      setAccessToken,
    })

    bootstrapAuthSession({
      api: bootstrapApi,
      shouldApply: () => isMounted,
      setAccessToken,
    })
      .then(() => {
        return undefined
      })
      .finally(() => {
        if (isMounted) {
          setIsBootstrapping(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [setAccessToken])

  const meQuery = useCurrentUserQuery({
    api,
    enabled: !isBootstrapping && Boolean(accessToken),
  })
  const { mutateAsync: registerAsync } = useRegisterMutation({ api, setAccessToken })
  const { mutateAsync: loginAsync } = useLoginMutation({ api, setAccessToken })
  const { mutateAsync: logoutAsync } = useLogoutMutation({ api, setAccessToken })

  const register = useCallback(
    async (input: RegisterRequest) => {
      await registerAsync(input)
    },
    [registerAsync],
  )

  const login = useCallback(
    async (input: LoginRequest) => {
      await loginAsync(input)
    },
    [loginAsync],
  )

  const logout = useCallback(async () => {
    await logoutAsync()
  }, [logoutAsync])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      isBootstrapping,
      isAuthenticated: Boolean(meQuery.data?.user),
      register,
      login,
      logout,
    }),
    [isBootstrapping, login, logout, meQuery.data?.user, register],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
