import { Link, Outlet, useLocation, useRouter, useSearch } from '@tanstack/react-router'
import type { UserDto, UserRole } from '@web-app-demo/contracts'
import { useEffect, useRef } from 'react'

import { PageContainer, PageHeader } from '@/components/PageLayout'
import {
  GuestAuthSection,
  SessionErrorSection,
  SessionLoadingSection,
} from '@/components/WebRouteSections'
import { WorkspaceShell } from '@/components/WorkspaceShell'
import { Button } from '@/components/ui/button'
import { AdminDashboard, AdminSettings, AdminUsers } from '@/features/admin'
import { useAuth } from '@/features/auth'
import { homePathForRole, safeReturnPath } from '@/features/navigation'
import { UserHome, UserProfile, UserSettings } from '@/features/users'

export function HomePage() {
  const auth = useAuth()
  const { returnTo } = useSearch({ from: '/' })

  if (auth.isBootstrapping) return <SessionLoadingSection />
  if (auth.sessionError && !auth.user) {
    return <SessionErrorSection retry={auth.retrySession} />
  }
  if (auth.user) {
    return (
      <HrefRedirect
        href={safeReturnPath(auth.user.role, returnTo) ?? homePathForRole(auth.user.role)}
      />
    )
  }
  return <GuestAuthSection />
}

export function UserHomePage() {
  const user = useWorkspaceUser('user')
  return <UserHome user={user} />
}

export function UserProfilePage() {
  const user = useWorkspaceUser('user')
  return <UserProfile user={user} />
}

export function UserSettingsPage() {
  const auth = useAuth()
  return <UserSettings onLogout={auth.logout} />
}

export function AdminDashboardPage() {
  return <AdminDashboard />
}

export function AdminUsersPage() {
  const user = useWorkspaceUser('admin')
  return <AdminUsers currentUser={user} />
}

export function AdminSettingsPage() {
  const user = useWorkspaceUser('admin')
  return <AdminSettings user={user} />
}

export function UserWorkspaceLayout() {
  return <WorkspaceRoute role="user" />
}

export function AdminWorkspaceLayout() {
  return <WorkspaceRoute role="admin" />
}

export function NotFoundPage() {
  const auth = useAuth()
  const destination = auth.user ? homePathForRole(auth.user.role) : '/'
  return (
    <main>
      <PageContainer>
        <PageHeader
          description="The page you requested does not exist."
          title="Page not found"
        />
        <div>
          <Button asChild>
            {destination === '/' ? (
              <Link search={{ returnTo: undefined }} to="/">Return home</Link>
            ) : (
              <Link to={destination}>Return home</Link>
            )}
          </Button>
        </div>
      </PageContainer>
    </main>
  )
}

function WorkspaceRoute({ role }: { role: UserRole }) {
  const auth = useAuth()
  const location = useLocation()

  if (auth.isBootstrapping) return <SessionLoadingSection />
  if (auth.sessionError && !auth.user) {
    return <SessionErrorSection retry={auth.retrySession} />
  }
  if (!auth.user) {
    const returnTo = `${location.pathname}${location.searchStr}`
    return <HrefRedirect href={`/?returnTo=${encodeURIComponent(returnTo)}`} />
  }
  if (auth.user.role !== role) {
    return <HrefRedirect href={homePathForRole(auth.user.role)} />
  }

  return (
    <WorkspaceShell onLogout={auth.logout} user={auth.user}>
      <Outlet />
    </WorkspaceShell>
  )
}

function useWorkspaceUser(role: UserRole): UserDto {
  const user = useAuth().user
  if (!user || user.role !== role) {
    throw new Error(`${role} workspace page rendered outside its guarded layout`)
  }
  return user
}

function HrefRedirect({ href }: { href: string }) {
  const router = useRouter()
  const hasRedirected = useRef(false)
  useEffect(() => {
    if (hasRedirected.current) return
    hasRedirected.current = true
    router.history.replace(href)
  }, [href, router])
  return null
}
