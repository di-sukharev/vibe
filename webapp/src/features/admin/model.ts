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
