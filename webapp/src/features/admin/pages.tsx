import type { UserDto } from '@web-app-demo/contracts'

import { PageContainer, PageHeader } from '@/components/PageLayout'
import { AppearancePanel } from '@/features/settings'
import { ProfilePanel } from '@/features/users'
import { AdminMetrics } from './AdminMetrics'
import { UserDirectory } from './UserDirectory'

export function AdminDashboard() {
  return (
    <PageContainer>
      <PageHeader
        description="A live overview of accounts and administrator coverage."
        title="Dashboard"
      />
      <AdminMetrics />
    </PageContainer>
  )
}

export function AdminUsers({ currentUser }: { currentUser: UserDto }) {
  return (
    <PageContainer>
      <PageHeader
        description="Find accounts and manage access without exposing credential data."
        title="Users"
      />
      <UserDirectory currentUser={currentUser} />
    </PageContainer>
  )
}

export function AdminSettings({ user }: { user: UserDto }) {
  return (
    <PageContainer>
      <PageHeader
        description="Manage your administrator identity and workspace appearance."
        title="Settings"
      />
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <ProfilePanel user={user} />
        <AppearancePanel />
      </div>
    </PageContainer>
  )
}
