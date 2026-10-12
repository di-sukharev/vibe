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

export type UserRoleTransaction = {
  findUser(id: string): Promise<UserRecord | null>
  countAdmins(): Promise<number>
  updateRoleAndRevoke(userId: string, role: UserRole, now: Date): Promise<AdminUserSummary>
}

export type UserRoleUpdater = {
  withRoleMutation<T>(targetUserId: string, run: (tx: UserRoleTransaction) => Promise<T>): Promise<T>
}

export type Clock = {
  now(): Date
}
