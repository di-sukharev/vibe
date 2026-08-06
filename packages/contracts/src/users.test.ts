import { describe, expect, test } from 'bun:test'

import {
  adminDashboardResponseSchema,
  adminUserParamsSchema,
  adminUserSummarySchema,
  adminUsersQuerySchema,
  adminUsersResponseSchema,
  updateProfileRequestSchema,
  updateUserRoleRequestSchema,
  userSchema,
} from './index'

const user = {
  id: '019c0000-0000-7000-8000-000000000001',
  email: 'user@example.com',
  displayName: 'User',
  role: 'user',
  createdAt: '2026-07-20T00:00:00.000Z',
} as const

describe('user and admin contracts', () => {
  test('requires one of the supported roles on every user DTO', () => {
    expect(userSchema.parse(user)).toEqual(user)
    expect(userSchema.parse({ ...user, role: 'admin' })).toEqual({ ...user, role: 'admin' })
    expect(() => userSchema.parse({ ...user, role: undefined })).toThrow()
    expect(() => userSchema.parse({ ...user, role: 'owner' })).toThrow()
  })

  test('normalizes profile updates and allows explicitly clearing the display name', () => {
    expect(updateProfileRequestSchema.parse({ displayName: '  Jane Doe  ' })).toEqual({
      displayName: 'Jane Doe',
    })
    expect(updateProfileRequestSchema.parse({ displayName: null })).toEqual({ displayName: null })
    expect(() => updateProfileRequestSchema.parse({ displayName: 'A' })).toThrow()
    expect(() => updateProfileRequestSchema.parse({ displayName: '' })).toThrow()
    expect(() =>
      updateProfileRequestSchema.parse({ displayName: 'Jane', role: 'admin' }),
    ).toThrow()
  })

  test('normalizes bounded admin list queries', () => {
    expect(adminUsersQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
    })
    expect(
      adminUsersQuerySchema.parse({ q: '  USER@EXAMPLE.COM  ', page: '2', pageSize: '100' }),
    ).toEqual({
      q: 'USER@EXAMPLE.COM',
      page: 2,
      pageSize: 100,
    })
    expect(() => adminUsersQuerySchema.parse({ page: '0' })).toThrow()
    expect(adminUsersQuerySchema.parse({ page: '100' }).page).toBe(100)
    expect(() => adminUsersQuerySchema.parse({ page: '101' })).toThrow()
    expect(() => adminUsersQuerySchema.parse({ pageSize: '101' })).toThrow()
  })

  test('exposes only the safe admin user summary and validates role changes', () => {
    const summary = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
    }
    expect(adminUserSummarySchema.parse(summary)).toEqual(summary)
    expect(() =>
      adminUserSummarySchema.parse({ ...summary, passwordHash: 'must-not-leak' }),
    ).toThrow()
    expect(updateUserRoleRequestSchema.parse({ role: 'admin' })).toEqual({ role: 'admin' })
    expect(() => updateUserRoleRequestSchema.parse({ role: 'owner' })).toThrow()
    expect(adminUserParamsSchema.parse({ userId: user.id })).toEqual({ userId: user.id })
    expect(() => adminUserParamsSchema.parse({ userId: 'not-a-uuid' })).toThrow()
  })

  test('validates dashboard and paginated user responses', () => {
    expect(
      adminDashboardResponseSchema.parse({
        totalUsers: 10,
        totalAdmins: 2,
        newUsersLast7Days: 3,
      }),
    ).toEqual({
      totalUsers: 10,
      totalAdmins: 2,
      newUsersLast7Days: 3,
    })
    expect(
      adminUsersResponseSchema.parse({
        items: [
          {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            role: user.role,
            createdAt: user.createdAt,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
        hasNext: false,
      }),
    ).toMatchObject({ page: 1, pageSize: 20, total: 1, hasNext: false })
  })
})
