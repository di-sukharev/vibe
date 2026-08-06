import type { UserDto } from '@web-app-demo/contracts'

import { PageContainer, PageHeader } from '@/components/PageLayout'
import { AppearancePanel } from '@/features/settings'
import { AccountSummary } from './AccountSummary'
import { ProfilePanel } from './ProfilePanel'
import { SessionPanel } from './SessionPanel'

export function UserHome({ user }: { user: UserDto }) {
  return (
    <PageContainer>
      <PageHeader
        description="Review your account status and continue managing your workspace."
        title={`Welcome, ${user.displayName ?? user.email}`}
      />
      <AccountSummary user={user} />
    </PageContainer>
  )
}

export function UserProfile({ user }: { user: UserDto }) {
  return (
    <PageContainer>
      <div className="grid w-full max-w-2xl gap-6">
        <PageHeader
          description="Keep the identity shown across your workspace current."
          title="Profile"
        />
        <ProfilePanel user={user} />
      </div>
    </PageContainer>
  )
}

export function UserSettings({ onLogout }: { onLogout: () => Promise<void> }) {
  return (
    <PageContainer>
      <PageHeader
        description="Choose how the workspace looks and manage your current session."
        title="Settings"
      />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <AppearancePanel />
        <SessionPanel onLogout={onLogout} />
      </div>
    </PageContainer>
  )
}
