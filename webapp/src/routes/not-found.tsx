import {
  NotFoundSection,
  SessionErrorSection,
  SessionLoadingSection,
} from '@/components/WebRouteSections'
import { useAuth } from '@/features/auth'
import { homePathForRole } from '@/features/navigation'

export default function NotFoundPage() {
  const auth = useAuth()

  if (auth.isBootstrapping) return <SessionLoadingSection />
  if (auth.sessionError && !auth.user) {
    return <SessionErrorSection retry={auth.retrySession} />
  }

  const destination = auth.user ? homePathForRole(auth.user.role) : '/login'
  return <NotFoundSection destination={destination} />
}
