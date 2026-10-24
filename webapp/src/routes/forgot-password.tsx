import { AuthPageShell, ForgotPasswordForm } from '@/features/auth'
import { GuestAuthPage } from '@/route-guards'

export default function ForgotPasswordPage() {
  return (
    <GuestAuthPage>
      <AuthPageShell>
        <ForgotPasswordForm />
      </AuthPageShell>
    </GuestAuthPage>
  )
}
