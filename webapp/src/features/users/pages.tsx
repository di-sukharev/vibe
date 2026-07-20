import type { UserDto } from '@web-app-demo/contracts'
import { useState } from 'react'

import { PageContainer, PageHeader } from '@/components/PageLayout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppearanceSettings } from '@/features/settings'
import { ProfileForm } from './ProfileForm'

export function UserHome({ user }: { user: UserDto }) {
  return (
    <PageContainer>
      <PageHeader
        description="A practical starting point for account-focused product features."
        title={`Welcome, ${user.displayName ?? user.email}`}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Account" value={user.email} />
        <SummaryCard label="Role" value={user.role} capitalize />
        <SummaryCard
          label="Subscription"
          value={user.subscription.isActive ? 'Active' : user.subscription.state}
          capitalize
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your workspace</CardTitle>
          <CardDescription>
            Use Profile to manage account identity and Settings to control appearance and session.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">Created {new Date(user.createdAt).toLocaleDateString()}</Badge>
          <Badge variant="outline">User ID {user.id}</Badge>
        </CardContent>
      </Card>
    </PageContainer>
  )
}

export function UserProfile({ user }: { user: UserDto }) {
  return (
    <PageContainer>
      <PageHeader
        description="Keep the identity shown across your workspace current."
        title="Profile"
      />
      <ProfileForm user={user} />
    </PageContainer>
  )
}

export function UserSettings({
  onLogout,
}: {
  onLogout: () => Promise<void>
}) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutFailed, setLogoutFailed] = useState(false)

  const logout = async () => {
    setIsLoggingOut(true)
    setLogoutFailed(false)
    try {
      await onLogout()
    } catch {
      setLogoutFailed(true)
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        description="Choose how the workspace looks and manage your current session."
        title="Settings"
      />
      <AppearanceSettings />
      <Card>
        <CardHeader>
          <CardTitle>Current session</CardTitle>
          <CardDescription>Sign out from this browser when you are finished.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {logoutFailed && (
            <Alert variant="destructive">
              <AlertTitle>Logout failed</AlertTitle>
              <AlertDescription>Your session is still active. Please try again.</AlertDescription>
            </Alert>
          )}
          <Button
            className="justify-self-start"
            disabled={isLoggingOut}
            onClick={() => void logout()}
            type="button"
            variant="outline"
          >
            {isLoggingOut ? 'Logging out...' : 'Logout'}
          </Button>
        </CardContent>
      </Card>
    </PageContainer>
  )
}

function SummaryCard({
  capitalize = false,
  label,
  value,
}: {
  capitalize?: boolean
  label: string
  value: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={capitalize ? 'capitalize' : undefined}>{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
