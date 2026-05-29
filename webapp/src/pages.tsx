import { Outlet } from '@tanstack/react-router'

import { AppShell } from '@/components/AppShell'
import {
  ActiveSessionSection,
  CurrentUserSection,
  GuestAuthSection,
  LoginRequiredSection,
  SessionLoadingSection,
} from '@/components/WebRouteSections'
import { useAuth } from '@/lib/use-auth'

export function RootLayout() {
  const auth = useAuth()

  return (
    <AppShell isAuthenticated={auth.isAuthenticated} onLogout={() => void auth.logout()}>
      <Outlet />
    </AppShell>
  )
}

export function HomePage() {
  const auth = useAuth()

  if (auth.isBootstrapping) {
    return <SessionLoadingSection />
  }

  if (auth.user) {
    return <ActiveSessionSection user={auth.user} />
  }

  return <GuestAuthSection />
}

export function AppPage() {
  const auth = useAuth()

  if (auth.isBootstrapping) {
    return <SessionLoadingSection />
  }

  if (!auth.user) {
    return <LoginRequiredSection />
  }

  return <CurrentUserSection user={auth.user} />
}
