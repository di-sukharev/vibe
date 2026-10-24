import { AdminSettings } from '@/features/admin'
import { useWorkspaceUser } from '@/route-guards'

export default function AdminSettingsPage() {
  const user = useWorkspaceUser('admin')
  return <AdminSettings user={user} />
}
