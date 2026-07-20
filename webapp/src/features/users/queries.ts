import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { MeResponse } from '@web-app-demo/contracts'

import { authQueryKeys, useAuth } from '@/features/auth'
import { updateProfile } from './api'

export function useUpdateProfileMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (displayName: string | null) =>
      updateProfile(auth.transport, { displayName }),
    onSuccess: (response) => {
      queryClient.setQueryData(
        authQueryKeys.me(),
        { user: response.user } satisfies MeResponse,
      )
    },
  })
}
