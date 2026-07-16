import {
  ActiveSessionSection,
  CurrentUserSection,
  GuestAuthSection,
  LoginRequiredSection,
  SessionErrorSection,
  SessionLoadingSection,
} from '@/components/WebRouteSections'
import { useAuth } from '@/features/auth'

export function HomePage() {
  const auth = useAuth()
  if (auth.isBootstrapping) return <SessionLoadingSection />
  if (auth.sessionError && !auth.user) return <SessionErrorSection retry={auth.retrySession} />
  if (auth.user) return <ActiveSessionSection user={auth.user} />
  return <GuestAuthSection />
}

export function AppPage() {
  const auth = useAuth()
  if (auth.isBootstrapping) return <SessionLoadingSection />
  if (auth.sessionError && !auth.user) return <SessionErrorSection retry={auth.retrySession} />
  if (!auth.user) return <LoginRequiredSection />
  return <CurrentUserSection user={auth.user} />
}
