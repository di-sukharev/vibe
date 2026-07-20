import { expect, test } from 'bun:test'

import {
  homePathForRole,
  navigationItemsForRole,
  resolveRoleDestination,
  safeReturnPath,
} from '../src/features/navigation/model'

test('role navigation exposes only the current workspace', () => {
  expect(navigationItemsForRole('user')).toEqual([
    { label: 'Home', to: '/app' },
    { label: 'Profile', to: '/app/profile' },
    { label: 'Settings', to: '/app/settings' },
  ])
  expect(navigationItemsForRole('admin')).toEqual([
    { label: 'Dashboard', to: '/admin' },
    { label: 'Users', to: '/admin/users' },
    { label: 'Settings', to: '/admin/settings' },
  ])
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
