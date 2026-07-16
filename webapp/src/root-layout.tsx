import { Outlet } from '@tanstack/react-router'
import { useState } from 'react'

import { AppShell } from '@/components/AppShell'
import { useAuth } from '@/features/auth'

export function RootLayout() {
  const auth = useAuth()
  const [logoutErrorUser, setLogoutErrorUser] = useState(auth.user)

  const logout = async () => {
    setLogoutErrorUser(null)
    try {
      await auth.logout()
    } catch {
      setLogoutErrorUser(auth.user)
    }
  }

  return (
    <AppShell
      isAuthenticated={auth.isAuthenticated}
      logoutFailed={Boolean(auth.user && logoutErrorUser === auth.user)}
      onLogout={() => void logout()}
    >
      <Outlet />
    </AppShell>
  )
}
