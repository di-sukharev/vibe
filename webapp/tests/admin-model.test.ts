import { expect, test } from 'bun:test'

import {
  adminUsersPagination,
  adminUsersViewState,
  roleMutationFeedback,
} from '../src/features/admin/model'

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

test('admin pagination reports canGoNext at the last reachable page of an unbounded total', () => {
  const base = { pageSize: 10, total: 50 } // ceil(50/10) = 5 pages, well under the server cap

  expect(adminUsersPagination({ ...base, hasNext: true, page: 2 })).toEqual({
    canGoNext: true,
    reachableUsers: 50,
    totalPages: 5,
    wasBounded: false,
  })
  expect(adminUsersPagination({ ...base, hasNext: true, page: 5 })).toEqual({
    canGoNext: false,
    reachableUsers: 50,
    totalPages: 5,
    wasBounded: false,
  })
  // page < totalPages here too, so this only goes false because hasNext is false
  expect(adminUsersPagination({ ...base, hasNext: false, page: 2 })).toEqual({
    canGoNext: false,
    reachableUsers: 50,
    totalPages: 5,
    wasBounded: false,
  })
})

test('role mutation exposes explicit error and success feedback', () => {
  expect(roleMutationFeedback({ isError: true, isSuccess: false })).toBe('error')
  expect(roleMutationFeedback({ isError: false, isSuccess: true })).toBe('success')
  expect(roleMutationFeedback({ isError: false, isSuccess: false })).toBeNull()
})
