import type { UserRole } from '@web-app-demo/contracts'

export type UserRoutePath = '/app' | '/app/profile' | '/app/settings'
export type AdminRoutePath = '/admin' | '/admin/users' | '/admin/settings'
export type WorkspaceRoutePath = UserRoutePath | AdminRoutePath

const navigationByRole = {
  user: [
    { label: 'Home', to: '/app' },
    { label: 'Profile', to: '/app/profile' },
    { label: 'Settings', to: '/app/settings' },
  ],
  admin: [
    { label: 'Dashboard', to: '/admin' },
    { label: 'Users', to: '/admin/users' },
    { label: 'Settings', to: '/admin/settings' },
  ],
} as const satisfies Record<UserRole, ReadonlyArray<{ label: string; to: WorkspaceRoutePath }>>

export function navigationItemsForRole(role: UserRole) {
  return navigationByRole[role]
}

export function homePathForRole(role: UserRole): '/app' | '/admin' {
  return role === 'admin' ? '/admin' : '/app'
}

export function resolveRoleDestination(
  role: UserRole,
  pathname: string,
): WorkspaceRoutePath {
  const match = navigationItemsForRole(role).find((item) => item.to === pathname)
  return match?.to ?? homePathForRole(role)
}

export function safeReturnPath(role: UserRole, value: string | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null

  let url: URL
  try {
    url = new URL(value, 'https://app.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'https://app.invalid') return null
  const destination = navigationItemsForRole(role).find((item) => item.to === url.pathname)
  return destination ? `${url.pathname}${url.search}` : null
}
