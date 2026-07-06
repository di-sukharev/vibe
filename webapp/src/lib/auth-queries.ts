import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type {
  AuthResponse,
  LoginRequest,
  MeResponse,
  RegisterRequest,
} from '@web-app-demo/contracts'

import type { ApiClient } from './api'

export const authQueryKeys = {
  all: ['auth'] as const,
  me: () => [...authQueryKeys.all, 'me'] as const,
}

type CurrentUserQueryOptions = {
  api: Pick<ApiClient, 'me'>
  enabled: boolean
}

type AuthMutationOptions = {
  api: Pick<ApiClient, 'login' | 'logout' | 'register'>
  setAccessToken: (accessToken: string | null) => void
}

export function useCurrentUserQuery({ api, enabled }: CurrentUserQueryOptions) {
  return useQuery({
    queryKey: authQueryKeys.me(),
    enabled,
    queryFn: () => api.me(),
  })
}

export function useRegisterMutation({ api, setAccessToken }: AuthMutationOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: RegisterRequest) => api.register(input),
    onSuccess: (response) => {
      applyAuthenticatedSession(queryClient, setAccessToken, response)
    },
  })
}

export function useLoginMutation({ api, setAccessToken }: AuthMutationOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: LoginRequest) => api.login(input),
    onSuccess: (response) => {
      applyAuthenticatedSession(queryClient, setAccessToken, response)
    },
  })
}

export function useLogoutMutation({ api, setAccessToken }: AuthMutationOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      await api.logout().catch(() => undefined)
    },
    onSettled: () => {
      clearAuthenticatedSession(queryClient, setAccessToken)
    },
  })
}

export function applyAuthenticatedSession(
  queryClient: QueryClient,
  setAccessToken: (accessToken: string | null) => void,
  response: AuthResponse,
) {
  setAccessToken(response.accessToken)
  queryClient.setQueryData(authQueryKeys.me(), { user: response.user } satisfies MeResponse)
}

export function clearAuthenticatedSession(
  queryClient: QueryClient,
  setAccessToken: (accessToken: string | null) => void,
) {
  setAccessToken(null)
  queryClient.removeQueries({ queryKey: authQueryKeys.me() })
}
