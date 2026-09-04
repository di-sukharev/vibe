import type { UserRole } from '@web-app-demo/contracts'

import { UsersFailure } from './errors'

/**
 * Pure guard rails around `updateRole`, pulled out of the Prisma transaction so they can be unit
 * tested without a database: only an admin actor may change roles, nobody may demote themselves,
 * and the last remaining admin cannot be demoted.
 */

export function assertActorIsAdmin(
  actor: { role: UserRole } | null,
): asserts actor is { role: UserRole } {
  if (actor?.role !== 'admin') {
    throw new UsersFailure('forbidden', 'Administrator access is required')
  }
}

export type RoleUpdateOutcome = 'noop' | 'update'

export async function decideRoleUpdate(input: {
  actorId: string
  target: { id: string; role: UserRole }
  requestedRole: UserRole
  countAdmins: () => Promise<number>
}): Promise<RoleUpdateOutcome> {
  if (input.target.role === input.requestedRole) {
    return 'noop'
  }
  if (input.target.id === input.actorId && input.requestedRole !== 'admin') {
    throw new UsersFailure('role_conflict', 'You cannot remove your own administrator role')
  }
  if (input.target.role === 'admin' && input.requestedRole === 'user') {
    const adminCount = await input.countAdmins()
    if (adminCount <= 1) {
      throw new UsersFailure('role_conflict', 'At least one administrator must remain')
    }
  }
  return 'update'
}
