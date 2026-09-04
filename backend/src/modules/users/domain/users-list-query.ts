import type { AdminUsersQuery } from '@web-app-demo/contracts'
import { ADMIN_USERS_MAX_PAGE } from '@web-app-demo/contracts'

/**
 * Pure translation of the admin users query into a Prisma filter plus offset pagination, kept
 * separate from `listUsers` so the page math (and the search filter it builds) can be unit tested
 * without a database.
 */
export function buildUsersListPlan(query: AdminUsersQuery) {
  const where = query.q
    ? {
        OR: [
          { email: { contains: query.q, mode: 'insensitive' as const } },
          { displayName: { contains: query.q, mode: 'insensitive' as const } },
        ],
      }
    : {}

  return {
    where,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  }
}

export function hasNextUsersPage(page: number, pageSize: number, total: number): boolean {
  return page < ADMIN_USERS_MAX_PAGE && page * pageSize < total
}
