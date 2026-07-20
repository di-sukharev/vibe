import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminUsersQuery, UserRole } from '@web-app-demo/contracts'

import { useAuth } from '@/features/auth'
import { getAdminDashboard, getAdminUsers, updateAdminUserRole } from './api'

const adminQueryKeys = {
  all: ['session', 'admin'] as const,
  dashboard: () => [...adminQueryKeys.all, 'dashboard'] as const,
  users: (query: AdminUsersQuery) => [...adminQueryKeys.all, 'users', query] as const,
}

export function useAdminDashboardQuery() {
  const auth = useAuth()
  return useQuery({
    queryKey: adminQueryKeys.dashboard(),
    queryFn: () => getAdminDashboard(auth.transport),
  })
}

export function useAdminUsersQuery(query: AdminUsersQuery) {
  const auth = useAuth()
  return useQuery({
    queryKey: adminQueryKeys.users(query),
    queryFn: () => getAdminUsers(auth.transport, query),
  })
}

export function useUpdateAdminUserRoleMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ role, userId }: { role: UserRole; userId: string }) =>
      updateAdminUserRole(auth.transport, userId, { role }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.dashboard() }),
        queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.all, 'users'] }),
      ])
    },
  })
}
