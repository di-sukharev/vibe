import { AdminUsers } from '@/features/admin'
import { useWorkspaceUser } from '@/route-guards'

export default function AdminUsersPage() {
  const user = useWorkspaceUser('admin')
  return <AdminUsers currentUser={user} />
}
