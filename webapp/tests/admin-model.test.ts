import { expect, test } from 'bun:test'

import {
  adminUsersPagination,
  adminUsersViewState,
  roleMutationFeedback,
} from '../src/features/admin/model'
import { ApiRequestError } from '../src/platform/api'

test('admin directory exposes loading, error, empty, and ready states', () => {
  expect(
    adminUsersViewState({ isPending: true, isError: false }),
  ).toBe('loading')
  expect(
    adminUsersViewState({ isPending: false, isError: true }),
  ).toBe('error')
  expect(
    adminUsersViewState({ isPending: false, isError: false, itemCount: 0 }),
  ).toBe('empty')
  expect(
    adminUsersViewState({ isPending: false, isError: false, itemCount: 1 }),
  ).toBe('ready')
})

test('admin pagination respects the reachable server window', () => {
  expect(adminUsersPagination({
    hasNext: false,
    page: 100,
    pageSize: 20,
    total: 2_001,
  })).toEqual({
    canGoNext: false,
    reachableUsers: 2_000,
    totalPages: 100,
    wasBounded: true,
  })
})

test('role mutation feedback relays the server reason and the changed user', () => {
  const user = {
    createdAt: '2026-01-01T00:00:00.000Z',
    displayName: null,
    email: 'member@example.com',
    id: 'user-1',
    role: 'admin' as const,
  }

  expect(
    roleMutationFeedback({
      data: undefined,
      error: new ApiRequestError(409, 'CONFLICT', 'At least one administrator must remain'),
      isError: true,
      isSuccess: false,
    }),
  ).toEqual({ kind: 'error', reason: 'At least one administrator must remain' })
  expect(
    roleMutationFeedback({ data: { user }, error: null, isError: false, isSuccess: true }),
  ).toEqual({ kind: 'success', user })
  expect(
    roleMutationFeedback({ data: undefined, error: null, isError: false, isSuccess: false }),
  ).toBeNull()
})
