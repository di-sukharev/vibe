export function readPasswordResetToken(location: Pick<Location, 'hash'>) {
  return new URLSearchParams(location.hash.slice(1)).get('token') ?? ''
}

export function clearPasswordResetTokenHash(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState' | 'state'>,
) {
  if (!location.hash) return
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
}
