import { UserHome } from '@/features/users'
import { useWorkspaceUser } from '@/route-guards'

export default function UserHomePage() {
  const user = useWorkspaceUser('user')
  return <UserHome user={user} />
}
