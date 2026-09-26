import { expect, test } from 'bun:test'

import { adminUsersPagination } from '../src/features/admin/model'

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
