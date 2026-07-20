import type { SubscriptionSnapshot, UserDto, UserRole } from '@web-app-demo/contracts'

export type AuthUserRecord = {
  id: string
  email: string
  passwordHash: string | null
  displayName: string | null
  role: UserRole
  createdAt: Date
}

export type AuthenticatedPrincipal = UserDto & {
  sessionId: string
}

export function toUserDto(
  user: AuthUserRecord,
  subscription: SubscriptionSnapshot,
): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    subscription,
  }
}

export function userDtoFromPrincipal(principal: AuthenticatedPrincipal): UserDto {
  const { sessionId: _sessionId, ...user } = principal
  return user
}
