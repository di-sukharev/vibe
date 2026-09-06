import {
  ADMIN_USERS_MAX_PAGE,
  type AdminUserSummary,
  type UpdateUserRoleResponse,
} from '@web-app-demo/contracts'

type AdminUsersQueryState = {
  isError: boolean
  isPending: boolean
  itemCount?: number
}

export function adminUsersViewState({
  isError,
  isPending,
  itemCount,
}: AdminUsersQueryState): 'loading' | 'error' | 'empty' | 'ready' {
  if (isPending) return 'loading'
  if (isError) return 'error'
  return itemCount === 0 ? 'empty' : 'ready'
}

export function adminUsersPagination({
  hasNext,
  page,
  pageSize,
  total,
}: {
  hasNext: boolean
  page: number
  pageSize: number
  total: number
}) {
  const unboundedPages = Math.max(1, Math.ceil(total / pageSize))
  const totalPages = Math.min(ADMIN_USERS_MAX_PAGE, unboundedPages)
  return {
    canGoNext: hasNext && page < totalPages,
    reachableUsers: Math.min(total, ADMIN_USERS_MAX_PAGE * pageSize),
    totalPages,
    wasBounded: unboundedPages > ADMIN_USERS_MAX_PAGE,
  }
}

export type RoleMutationFeedback =
  | { kind: 'error'; reason: string }
  | { kind: 'success'; user: AdminUserSummary }
  | null

/**
 * Everything the directory shows about the last role change comes from here. The error branch
 * carries the mutation error's message as the reason: for the backend's policy answers (last
 * administrator, self-demotion) that is the sentence the person needs, and the dialog renders it
 * under its heading instead of reaching into the raw mutation error. Network and response-shape
 * failures surface their own message the same way, as every other alert in this feature does.
 */
export function roleMutationFeedback({
  data,
  error,
  isError,
  isSuccess,
}: {
  data: UpdateUserRoleResponse | undefined
  error: Error | null
  isError: boolean
  isSuccess: boolean
}): RoleMutationFeedback {
  if (isError && error) return { kind: 'error', reason: error.message }
  if (isSuccess && data) return { kind: 'success', user: data.user }
  return null
}
