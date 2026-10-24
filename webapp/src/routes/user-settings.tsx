import { useAuth } from '@/features/auth'
import { UserSettings } from '@/features/users'

export default function UserSettingsPage() {
  const auth = useAuth()
  return <UserSettings onLogout={auth.logout} />
}
