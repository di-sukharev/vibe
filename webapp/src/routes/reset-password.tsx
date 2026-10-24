import { SessionLoadingSection } from '@/components/WebRouteSections'
import { AuthPageShell, ResetPasswordForm, useAuth } from '@/features/auth'
import { usePasswordResetToken } from '@/route-guards'

export default function ResetPasswordPage() {
  const auth = useAuth()
  const token = usePasswordResetToken()
  if (auth.isBootstrapping) return <SessionLoadingSection />

  return (
    <AuthPageShell>
      <ResetPasswordForm token={token} />
    </AuthPageShell>
  )
}
