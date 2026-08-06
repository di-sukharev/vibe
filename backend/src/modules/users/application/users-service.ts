import type {
  AdminUsersQuery,
  UpdateProfileRequest,
  UpdateUserRoleRequest,
  UserDto,
} from '@web-app-demo/contracts'

import type { AuthenticatedPrincipal } from '../../auth'
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
    return {
      user: await this.dependencies.userRoleUpdater.updateRole({
        actorUserId: principal.id,
        targetUserId,
        role: input.role,
        now: this.dependencies.clock.now(),
      }),
    }
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
