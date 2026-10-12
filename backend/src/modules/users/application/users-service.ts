import type {
  AdminUsersQuery,
  UpdateProfileRequest,
  UpdateUserRoleRequest,
  UserDto,
} from '@web-app-demo/contracts'

import type { AuthenticatedPrincipal } from '../../auth'
import { UsersFailure } from '../domain/errors'
import type {
  AdminDashboardReader,
  AdminUsersReader,
  Clock,
  ProfileWriter,
  UserRecord,
  UserRoleUpdater,
} from './ports'

type UsersServiceDependencies = {
  adminDashboardReader: AdminDashboardReader
  adminUsersReader: AdminUsersReader
  clock: Clock
  profileWriter: ProfileWriter
  userRoleUpdater: UserRoleUpdater
}

export class UsersService {
  constructor(private readonly dependencies: UsersServiceDependencies) {}

  async updateProfile(principal: AuthenticatedPrincipal, input: UpdateProfileRequest) {
    const user = await this.dependencies.profileWriter.updateProfile(
      principal.id,
      input.displayName,
    )
    return {
      user: this.userDto(user),
    }
  }

  dashboard() {
    const createdAfter = new Date(this.dependencies.clock.now().getTime() - 7 * 24 * 60 * 60 * 1000)
    return this.dependencies.adminDashboardReader.dashboard(createdAfter)
  }

  listUsers(query: AdminUsersQuery) {
    return this.dependencies.adminUsersReader.listUsers(query)
  }

  async updateRole(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
    input: UpdateUserRoleRequest,
  ) {
    const user = await this.dependencies.userRoleUpdater.withRoleMutation(targetUserId, async (tx) => {
      const actor = await tx.findUser(principal.id)
      if (actor?.role !== 'admin') {
        throw new UsersFailure('forbidden', 'Administrator access is required')
      }
      const target = await tx.findUser(targetUserId)
      if (!target) throw new UsersFailure('not_found', 'User not found')
      if (target.role === input.role) return this.userDto(target)
      if (target.id === actor.id && input.role !== 'admin') {
        throw new UsersFailure('role_conflict', 'You cannot remove your own administrator role')
      }
      if (target.role === 'admin' && input.role === 'user' && await tx.countAdmins() <= 1) {
        throw new UsersFailure('role_conflict', 'At least one administrator must remain')
      }
      return tx.updateRoleAndRevoke(target.id, input.role, this.dependencies.clock.now())
    })
    return { user }
  }

  private userDto(user: UserRecord): UserDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    }
  }
}
