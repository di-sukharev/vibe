import type {
  AdminDashboardResponse,
  AdminUserSummary,
  AdminUsersQuery,
  AdminUsersResponse,
  UserRole,
} from '@web-app-demo/contracts'

export type UserRecord = {
  id: string
  email: string
  displayName: string | null
  role: UserRole
  createdAt: Date
}

export type ProfileWriter = {
  updateProfile(userId: string, displayName: string | null): Promise<UserRecord>
}

export type AdminDashboardReader = {
  dashboard(createdAfter: Date): Promise<AdminDashboardResponse>
}

export type AdminUsersReader = {
  listUsers(query: AdminUsersQuery): Promise<AdminUsersResponse>
}

export type UserRoleUpdater = {
  updateRole(input: {
    actorUserId: string
    targetUserId: string
    role: UserRole
    now: Date
  }): Promise<AdminUserSummary>
}

export type Clock = {
  now(): Date
}
