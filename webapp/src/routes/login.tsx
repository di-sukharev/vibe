import { useSearchParams } from 'react-router'
import { AuthPageShell, LoginForm } from '@/features/auth'
import { GuestAuthPage } from '@/route-guards'

export default function LoginPage() {
  const [search] = useSearchParams()
  const returnTo = search.get('returnTo') ?? undefined
  return (
    <GuestAuthPage returnTo={returnTo}>
      <AuthPageShell>
        <LoginForm returnTo={returnTo} />
      </AuthPageShell>
    </GuestAuthPage>
  )
}
