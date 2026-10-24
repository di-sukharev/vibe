import { Navigate, Outlet, useLocation } from 'react-router'
import type { UserDto, UserRole } from '@web-app-demo/contracts'
import { useEffect, useState, type ReactNode } from 'react'

import {
  SessionErrorSection,
  SessionLoadingSection,
} from '@/components/WebRouteSections'
import { WorkspaceShell } from '@/components/WorkspaceShell'
import {
  clearPasswordResetTokenHash,
  readPasswordResetToken,
  useAuth,
} from '@/features/auth'
import { homePathForRole, safeReturnPath } from '@/features/navigation'

export function WorkspaceRoute({ role }: { role: UserRole }) {
  const auth = useAuth()
  const location = useLocation()

  if (auth.isBootstrapping) return <SessionLoadingSection />
  if (auth.sessionError && !auth.user) {
    return <SessionErrorSection retry={auth.retrySession} />
  }
  if (!auth.user) {
    const returnTo = `${location.pathname}${location.search}`
    return (
      <HrefRedirect href={`/login?returnTo=${encodeURIComponent(returnTo)}`} />
    )
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

export function GuestAuthPage({
  children,
  returnTo,
}: {
  children: ReactNode
  returnTo?: string
}) {
  const auth = useAuth()

  if (auth.isBootstrapping) return <SessionLoadingSection />
  if (auth.sessionError && !auth.user) {
    return <SessionErrorSection retry={auth.retrySession} />
  }
  if (auth.user) {
    return (
      <HrefRedirect
        href={
          safeReturnPath(auth.user.role, returnTo) ??
          homePathForRole(auth.user.role)
        }
      />
    )
  }

  return children
}

export function usePasswordResetToken() {
  const [token, setToken] = useState(() => {
    if (typeof window === 'undefined') return ''
    return readPasswordResetToken(window.location)
  })

  useEffect(() => {
    const captureToken = () => {
      const nextToken = readPasswordResetToken(window.location)
      if (!nextToken) return
      setToken(nextToken)
      clearPasswordResetTokenHash(window.location, window.history)
    }

    captureToken()
    window.addEventListener('hashchange', captureToken)
    return () => window.removeEventListener('hashchange', captureToken)
  }, [])

  return token
}

export function useWorkspaceUser(role: UserRole): UserDto {
  const user = useAuth().user
  if (!user || user.role !== role) {
    throw new Error(
      `${role} workspace page rendered outside its guarded layout`,
    )
  }
  return user
}

export function HrefRedirect({ href }: { href: string }) {
  return <Navigate to={href} replace />
}
