import { useSearchParams } from 'react-router'
import { AuthPageShell, RegisterForm } from '@/features/auth'
import { GuestAuthPage } from '@/route-guards'

export default function SignupPage() {
  const [search] = useSearchParams()
  const returnTo = search.get('returnTo') ?? undefined
  return (
    <GuestAuthPage returnTo={returnTo}>
      <AuthPageShell>
        <RegisterForm returnTo={returnTo} />
      </AuthPageShell>
    </GuestAuthPage>
  )
}
