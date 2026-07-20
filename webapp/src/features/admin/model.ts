import { ADMIN_USERS_MAX_PAGE } from '@web-app-demo/contracts'

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

export function roleMutationFeedback({
  isError,
  isSuccess,
}: {
  isError: boolean
  isSuccess: boolean
}): 'error' | 'success' | null {
  if (isError) return 'error'
  if (isSuccess) return 'success'
  return null
}
