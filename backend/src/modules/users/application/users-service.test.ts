import { expect, test } from 'bun:test'

import type { AuthenticatedPrincipal } from '../../auth'
import { UsersService } from './users-service'

test('profile updates answer from the write result without a post-write read', async () => {
  const principal: AuthenticatedPrincipal = {
    id: 'user-1',
    email: 'profile@example.com',
    displayName: null,
    role: 'user',
    createdAt: '2026-07-20T00:00:00.000Z',
    sessionId: 'session-1',
  }
  const service = new UsersService({
    adminDashboardReader: { dashboard: async () => ({
      totalUsers: 0,
      totalAdmins: 0,
      newUsersLast7Days: 0,
    }) },
    adminUsersReader: { listUsers: async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasNext: false,
    }) },
    clock: { now: () => new Date('2026-07-20T00:00:00.000Z') },
    profileWriter: {
      updateProfile: async (_userId, displayName) => ({
        id: principal.id,
        email: principal.email,
        displayName,
        role: principal.role,
        createdAt: new Date(principal.createdAt),
      }),
    },
    userRoleUpdater: { updateRole: async () => {
      throw new Error('not used')
    } },
  })

  await expect(service.updateProfile(principal, { displayName: 'Updated Name' })).resolves.toEqual({
    user: {
      id: principal.id,
      email: principal.email,
      displayName: 'Updated Name',
      role: principal.role,
      createdAt: principal.createdAt,
    },
  })
})
