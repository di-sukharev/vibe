import { describe, expect, test } from 'bun:test'

import type { AuthenticatedPrincipal } from '../../auth'
import type {
  AdminDashboardReader,
  AdminUsersReader,
  Clock,
  ProfileWriter,
  UserRecord,
  UserRoleUpdater,
} from './ports'
import { UsersService } from './users-service'

const principal: AuthenticatedPrincipal = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User One',
  role: 'admin',
  createdAt: '2026-08-01T00:00:00.000Z',
  sessionId: 'session-1',
}

const userRecord: UserRecord = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'Updated Name',
  role: 'admin',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
}

function createService(overrides?: {
  clock?: Clock
  profileWriter?: Partial<ProfileWriter>
  adminDashboardReader?: Partial<AdminDashboardReader>
  adminUsersReader?: Partial<AdminUsersReader>
  userRoleUpdater?: Partial<UserRoleUpdater>
}) {
  const calls: { dashboardCreatedAfter?: Date; roleUpdateInput?: unknown } = {}

  return {
    calls,
    service: new UsersService({
      clock: overrides?.clock ?? { now: () => new Date('2026-08-10T00:00:00.000Z') },
      profileWriter: {
        updateProfile: async () => userRecord,
        ...overrides?.profileWriter,
      },
      adminDashboardReader: {
        dashboard: async (createdAfter) => {
          calls.dashboardCreatedAfter = createdAfter
          return { totalUsers: 1, totalAdmins: 1, newUsersLast7Days: 0 }
        },
        ...overrides?.adminDashboardReader,
      },
      adminUsersReader: {
        listUsers: async () => ({ items: [], page: 1, pageSize: 20, total: 0, hasNext: false }),
        ...overrides?.adminUsersReader,
      },
      userRoleUpdater: {
        updateRole: async (input) => {
          calls.roleUpdateInput = input
          return {
            id: input.targetUserId,
            email: 'target@example.com',
            displayName: null,
            role: input.role,
            createdAt: '2026-08-01T00:00:00.000Z',
          }
        },
        ...overrides?.userRoleUpdater,
      },
    }),
  }
}

describe('UsersService', () => {
  test('updateProfile returns the user as a DTO', async () => {
    const { service } = createService()

    const result = await service.updateProfile(principal, { displayName: 'Updated Name' })

    expect(result).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        displayName: 'Updated Name',
        role: 'admin',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    })
  })

  test('dashboard asks for users created in the last 7 days', async () => {
    const { service, calls } = createService({
      clock: { now: () => new Date('2026-08-10T00:00:00.000Z') },
    })

    await service.dashboard()

    expect(calls.dashboardCreatedAfter).toEqual(new Date('2026-08-03T00:00:00.000Z'))
  })

  test('listUsers passes the query straight through', async () => {
    let receivedQuery: unknown
    const { service } = createService({
      adminUsersReader: {
        listUsers: async (query) => {
          receivedQuery = query
          return { items: [], page: 2, pageSize: 10, total: 0, hasNext: false }
        },
      },
    })

    const result = await service.listUsers({ page: 2, pageSize: 10 })

    expect(receivedQuery).toEqual({ page: 2, pageSize: 10 })
    expect(result).toEqual({ items: [], page: 2, pageSize: 10, total: 0, hasNext: false })
  })

  test('updateRole forwards the actor, target, role and current time', async () => {
    const { service, calls } = createService({
      clock: { now: () => new Date('2026-08-10T00:00:00.000Z') },
    })

    const result = await service.updateRole(principal, 'target-1', { role: 'admin' })

    expect(calls.roleUpdateInput).toEqual({
      actorUserId: 'user-1',
      targetUserId: 'target-1',
      role: 'admin',
      now: new Date('2026-08-10T00:00:00.000Z'),
    })
    expect(result.user.id).toBe('target-1')
  })
})
