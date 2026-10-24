import { useSearchParams } from 'react-router'
import {
  SessionErrorSection,
  SessionLoadingSection,
} from '@/components/WebRouteSections'
import { useAuth } from '@/features/auth'
import { homePathForRole, safeReturnPath } from '@/features/navigation'
import { HrefRedirect } from '@/route-guards'

export default function HomePage() {
  const auth = useAuth()
  const [search] = useSearchParams()
  const returnTo = search.get('returnTo') ?? undefined

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
  const destination = returnTo
    ? `/login?returnTo=${encodeURIComponent(returnTo)}`
    : '/login'
  return <HrefRedirect href={destination} />
}
