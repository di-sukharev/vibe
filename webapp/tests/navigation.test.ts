import { expect, test } from 'bun:test'
import type { UserRole } from '@web-app-demo/contracts'

import {
  homePathForRole,
  navigationItemsForRole,
  resolveRoleDestination,
  safeReturnPath,
  workspaceRoutesByRole,
} from '../src/features/navigation/model'
import { router } from '../src/routes'

test('role navigation exposes only the current workspace', () => {
  // Asserted as a boundary, not as a list: a new menu entry is a product decision, while an admin
  // path reachable from the user menu is a bug.
  expect(navigationItemsForRole('user').every((item) => item.to.startsWith('/app'))).toBe(true)
  expect(navigationItemsForRole('admin').every((item) => item.to.startsWith('/admin'))).toBe(true)
  expect(homePathForRole('user')).toBe('/app')
  expect(homePathForRole('admin')).toBe('/admin')
})

test('cross-role destinations resolve to the current role home', () => {
  expect(resolveRoleDestination('user', '/app/profile')).toBe('/app/profile')
  expect(resolveRoleDestination('user', '/admin/users')).toBe('/app')
  expect(resolveRoleDestination('admin', '/admin/settings')).toBe('/admin/settings')
  expect(resolveRoleDestination('admin', '/app')).toBe('/admin')
})

test('workspace route table matches the routes registered under each workspace layout', () => {
  // `WorkspaceRoute` in `src/pages.tsx` guards these two layout ids. Every path registered below
  // them is a protected route that must survive a login round-trip whether or not it is in the
  // sidebar, so the return-path allow-list is pinned to the router, not to the menu.
  const rolesByLayoutId: Record<string, UserRole> = {
    '/adminWorkspace': 'admin',
    '/userWorkspace': 'user',
  }
  const registered: Record<UserRole, string[]> = { admin: [], user: [] }

  for (const route of Object.values(router.routesById)) {
    if (typeof route.path !== 'string') continue
    let layout = route.parentRoute
    while (layout && !(layout.id in rolesByLayoutId)) layout = layout.parentRoute
    if (!layout) continue
    registered[rolesByLayoutId[layout.id]].push(route.fullPath)
  }

  expect(registered.user.toSorted()).toEqual([...workspaceRoutesByRole.user].toSorted())
  expect(registered.admin.toSorted()).toEqual([...workspaceRoutesByRole.admin].toSorted())
})

test('workspace route table uses only route shapes the return-path matcher understands', () => {
  // The matcher knows literal segments and named `$param` segments. Any other TanStack shape (a
  // bare `$` splat, `{-$optional}`, prefixed params) would silently send the return path to the
  // role home, so registering one must fail here, next to the table it would have to join.
  const supportedSegment = /^(\$[A-Za-z_]\w*|[^${}]+)$/

  for (const pattern of [...workspaceRoutesByRole.user, ...workspaceRoutesByRole.admin]) {
    for (const segment of pattern.split('/').slice(1)) {
      expect(segment).toMatch(supportedSegment)
    }
  }
})

test('every protected route of the role round-trips as a return path', () => {
  for (const role of ['user', 'admin'] as const) {
    for (const path of workspaceRoutesByRole[role]) {
      expect(safeReturnPath(role, path)).toBe(path)
    }
  }
  expect(safeReturnPath('admin', '/admin/users?page=2')).toBe('/admin/users?page=2')
})

test('parameterised protected routes round-trip for the owning role only', () => {
  const routes = {
    admin: ['/admin', '/admin/users/$userId'],
    user: ['/app', '/app/projects/$projectId'],
  }

  expect(safeReturnPath('user', '/app/projects/42?tab=files', routes)).toBe(
    '/app/projects/42?tab=files',
  )
  expect(safeReturnPath('admin', '/admin/users/7', routes)).toBe('/admin/users/7')
  // The other role's parameterised route is still a cross-role path.
  expect(safeReturnPath('admin', '/app/projects/42', routes)).toBeNull()
  expect(safeReturnPath('user', '/admin/users/7', routes)).toBeNull()
  // A parameter must be present, non-empty, and a single segment.
  expect(safeReturnPath('user', '/app/projects', routes)).toBeNull()
  expect(safeReturnPath('user', '/app/projects/', routes)).toBeNull()
  expect(safeReturnPath('user', '/app/projects/42/extra', routes)).toBeNull()
})

test('route shapes the matcher does not support fall back to the role home', () => {
  // A bare `$` splat and an optional param are registered in TanStack syntax but not understood
  // here; they must never match, so the login round-trip lands on the home page, not off-site.
  const routes = { admin: ['/admin'], user: ['/app/files/$', '/app/docs/{-$docId}'] }

  expect(safeReturnPath('user', '/app/files/a', routes)).toBeNull()
  expect(safeReturnPath('user', '/app/files/a/b', routes)).toBeNull()
  expect(safeReturnPath('user', '/app/docs', routes)).toBeNull()
  expect(safeReturnPath('user', '/app/docs/1', routes)).toBeNull()
})

test('return paths reject other roles, public pages, and every open-redirect shape', () => {
  expect(safeReturnPath('user', '/admin')).toBeNull()
  expect(safeReturnPath('admin', '/app/profile')).toBeNull()
  expect(safeReturnPath('user', '/')).toBeNull()
  expect(safeReturnPath('user', '/login')).toBeNull()
  expect(safeReturnPath('user', '/forgot-password')).toBeNull()
  expect(safeReturnPath('user', '/app/unknown')).toBeNull()
  expect(safeReturnPath('user', '/app/profile/extra')).toBeNull()

  expect(safeReturnPath('admin', undefined)).toBeNull()
  expect(safeReturnPath('admin', '')).toBeNull()
  expect(safeReturnPath('admin', 'admin')).toBeNull()
  expect(safeReturnPath('admin', 'https://attacker.example/admin')).toBeNull()
  expect(safeReturnPath('admin', 'javascript:alert(1)')).toBeNull()
  expect(safeReturnPath('admin', '//attacker.example/admin')).toBeNull()
  expect(safeReturnPath('admin', '/\\attacker.example/admin')).toBeNull()
  expect(safeReturnPath('admin', '\\\\attacker.example/admin')).toBeNull()
  expect(safeReturnPath('admin', '/%5C%5Cattacker.example/admin')).toBeNull()
  expect(safeReturnPath('admin', '/admin%2F..%2F%2Fattacker.example')).toBeNull()
})
