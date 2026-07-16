import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type {
  CookieAuthResponse,
  LoginRequest,
  MeResponse,
  RegisterRequest,
} from '@web-app-demo/contracts'

import type { AuthApi } from './api'

export const sessionQueryKeys = {
  all: ['session'] as const,
}

export const authQueryKeys = {
  all: [...sessionQueryKeys.all, 'auth'] as const,
  me: () => [...authQueryKeys.all, 'me'] as const,
}

type CurrentUserQueryOptions = {
  api: Pick<AuthApi, 'me'>
  enabled: boolean
}

type AuthMutationOptions = {
  api: Pick<AuthApi, 'isSessionEpochCurrent' | 'login' | 'logout' | 'register'>
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
    onSuccess: (transition) => {
      if (!api.isSessionEpochCurrent(transition.sessionEpoch)) return
      applyAuthenticatedSession(queryClient, setAccessToken, transition.data)
    },
  })
}

export function useLoginMutation({ api, setAccessToken }: AuthMutationOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: LoginRequest) => api.login(input),
    onSuccess: (transition) => {
      if (!api.isSessionEpochCurrent(transition.sessionEpoch)) return
      applyAuthenticatedSession(queryClient, setAccessToken, transition.data)
    },
  })
}

export function useLogoutMutation({ api, setAccessToken }: AuthMutationOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => logoutAuthenticatedSession({ api, queryClient, setAccessToken }),
  })
}

export async function logoutAuthenticatedSession({
  api,
  queryClient,
  setAccessToken,
}: {
  api: Pick<AuthApi, 'isSessionEpochCurrent' | 'logout'>
  queryClient: QueryClient
  setAccessToken: (accessToken: string | null) => void
}) {
  const transition = await api.logout()
  if (!transition || !api.isSessionEpochCurrent(transition.sessionEpoch)) return
  await clearAuthenticatedSession(queryClient, setAccessToken)
}

export function applyAuthenticatedSession(
  queryClient: QueryClient,
  setAccessToken: (accessToken: string | null) => void,
  response: CookieAuthResponse,
) {
  queryClient.removeQueries({ queryKey: sessionQueryKeys.all })
  setAccessToken(response.accessToken)
  queryClient.setQueryData(authQueryKeys.me(), { user: response.user } satisfies MeResponse)
}

export async function clearAuthenticatedSession(
  queryClient: QueryClient,
  setAccessToken: (accessToken: string | null) => void,
) {
  setAccessToken(null)
  queryClient.removeQueries({ queryKey: sessionQueryKeys.all })
}
