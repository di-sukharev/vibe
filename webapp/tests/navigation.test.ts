import { expect, test } from 'bun:test'

import {
  homePathForRole,
  navigationItemsForRole,
  resolveRoleDestination,
  safeReturnPath,
} from '../src/features/navigation/model'

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

test('return paths accept only known internal destinations for the current role', () => {
  expect(safeReturnPath('user', '/app/profile')).toBe('/app/profile')
  expect(safeReturnPath('admin', '/admin/users?page=2')).toBe('/admin/users?page=2')
  expect(safeReturnPath('user', '/admin')).toBeNull()
  expect(safeReturnPath('admin', 'https://attacker.example/admin')).toBeNull()
  expect(safeReturnPath('admin', '//attacker.example/admin')).toBeNull()
  expect(safeReturnPath('user', '/app/unknown')).toBeNull()
})
