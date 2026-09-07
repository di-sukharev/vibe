import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminUsersQuery, UserRole } from '@web-app-demo/contracts'

import { useAuth } from '@/features/auth'
import type { AuthenticatedTransport } from '@/platform/api'
import { getAdminDashboard, getAdminUsers, updateAdminUserRole } from './api'

const adminQueryKeys = {
  all: ['session', 'admin'] as const,
  dashboard: () => [...adminQueryKeys.all, 'dashboard'] as const,
  users: (query: AdminUsersQuery) => [...adminQueryKeys.all, 'users', query] as const,
}

export function adminDashboardQueryOptions(transport: AuthenticatedTransport) {
  return queryOptions({
    queryKey: adminQueryKeys.dashboard(),
    queryFn: ({ signal }) => getAdminDashboard(transport, { signal }),
  })
}

export function adminUsersQueryOptions(transport: AuthenticatedTransport, query: AdminUsersQuery) {
  return queryOptions({
    queryKey: adminQueryKeys.users(query),
    // Every page or search term is its own key. Forwarding the signal aborts the superseded page
    // when the key changes: the browser stops downloading a response nobody will render, and a
    // cancelled request is never retried after a token refresh. A request already dispatched
    // still counts against the backend's admin read rate limit, which increments on arrival.
    queryFn: ({ signal }) => getAdminUsers(transport, query, { signal }),
  })
}

export function useAdminDashboardQuery() {
  const auth = useAuth()
  return useQuery(adminDashboardQueryOptions(auth.transport))
}

export function useAdminUsersQuery(query: AdminUsersQuery) {
  const auth = useAuth()
  return useQuery(adminUsersQueryOptions(auth.transport, query))
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
