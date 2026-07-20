import { expect, test } from 'bun:test'

import type { AuthenticatedPrincipal } from '../../auth'
import { UsersService } from './users-service'

const subscription = {
  entitlement: 'premium' as const,
  expiresAt: null,
  isActive: false,
  originalTransactionId: null,
  platform: null,
  productId: null,
  state: 'inactive' as const,
  transactionId: null,
  updatedAt: null,
  willAutoRenew: null,
}

test('profile updates return the authenticated subscription snapshot without a post-write read', async () => {
  const principal: AuthenticatedPrincipal = {
    id: 'user-1',
    email: 'profile@example.com',
    displayName: null,
    role: 'user',
    createdAt: '2026-07-20T00:00:00.000Z',
    sessionId: 'session-1',
    subscription,
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
      subscription,
    },
  })
})
