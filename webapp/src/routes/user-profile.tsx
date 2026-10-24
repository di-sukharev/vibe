import { UserProfile } from '@/features/users'
import { useWorkspaceUser } from '@/route-guards'

export default function UserProfilePage() {
  const user = useWorkspaceUser('user')
  return <UserProfile user={user} />
}
