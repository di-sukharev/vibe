import { describe, expect, test } from 'bun:test'

import { buildUsersListPlan, hasNextUsersPage } from './users-list-query'

describe('buildUsersListPlan', () => {
  test('has no filter when there is no search term', () => {
    expect(buildUsersListPlan({ page: 1, pageSize: 20 }).where).toEqual({})
  })

  test('matches email or display name, case-insensitively, when searching', () => {
    expect(buildUsersListPlan({ page: 1, pageSize: 20, q: 'ann' }).where).toEqual({
      OR: [
        { email: { contains: 'ann', mode: 'insensitive' } },
        { displayName: { contains: 'ann', mode: 'insensitive' } },
      ],
    })
  })

  test('computes the offset from page and pageSize', () => {
    expect(buildUsersListPlan({ page: 1, pageSize: 20 })).toMatchObject({ skip: 0, take: 20 })
    expect(buildUsersListPlan({ page: 3, pageSize: 20 })).toMatchObject({ skip: 40, take: 20 })
    expect(buildUsersListPlan({ page: 2, pageSize: 5 })).toMatchObject({ skip: 5, take: 5 })
  })
})

describe('hasNextUsersPage', () => {
  test('is true while more rows remain within the page cap', () => {
    expect(hasNextUsersPage(1, 20, 21)).toBe(true)
  })

  test('is false once the current page reaches the total', () => {
    expect(hasNextUsersPage(1, 20, 20)).toBe(false)
    expect(hasNextUsersPage(2, 20, 21)).toBe(false)
  })

  test('is false past the maximum page even if rows remain', () => {
    expect(hasNextUsersPage(100, 20, 10_000)).toBe(false)
  })
})
