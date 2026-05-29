import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LoginRequest, RegisterRequest } from '@web-app-demo/contracts'
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { ApiClient } from './api'
import { AuthContext, type AuthContextValue } from './auth-context'
import { bootstrapAuthSession } from './bootstrap-auth'

const meQueryKey = ['auth', 'me'] as const

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [accessToken, setAccessTokenState] = useState<string | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  const setAccessToken = useCallback(
    (nextAccessToken: string | null) => setAccessTokenState(nextAccessToken),
    [],
  )
  const handleAuthExpired = useCallback(() => {
    setAccessToken(null)
    queryClient.removeQueries({ queryKey: meQueryKey })
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

  const meQuery = useQuery({
    queryKey: meQueryKey,
    enabled: !isBootstrapping && Boolean(accessToken),
    queryFn: () => api.me(),
  })

  const register = useCallback(
    async (input: RegisterRequest) => {
      const response = await api.register(input)
      setAccessToken(response.accessToken)
      queryClient.setQueryData(meQueryKey, { user: response.user })
    },
    [api, queryClient, setAccessToken],
  )

  const login = useCallback(
    async (input: LoginRequest) => {
      const response = await api.login(input)
      setAccessToken(response.accessToken)
      queryClient.setQueryData(meQueryKey, { user: response.user })
    },
    [api, queryClient, setAccessToken],
  )

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined)
    setAccessToken(null)
    queryClient.removeQueries({ queryKey: meQueryKey })
  }, [api, queryClient, setAccessToken])

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
