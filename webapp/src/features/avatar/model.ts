import type { UserDto } from '@web-app-demo/contracts'

export function initials(user: UserDto) {
  const source = user.displayName?.trim() || user.email

  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
