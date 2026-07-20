import {
  UserAdd01Icon,
  UserGroupIcon,
  UserShield01Icon,
} from '@hugeicons/core-free-icons'

import { SectionCards } from '@/components/dashboard'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdminDashboardQuery } from './queries'

export function AdminMetrics() {
  const query = useAdminDashboardQuery()

  if (query.isPending) {
    return (
      <div
        aria-label="Loading dashboard"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        role="status"
      >
        <Skeleton className="h-40 rounded-4xl" />
        <Skeleton className="h-40 rounded-4xl" />
        <Skeleton className="h-40 rounded-4xl" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Dashboard is unavailable</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
        <AlertAction>
          <Button onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
            Try again
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  return (
    <SectionCards
      items={[
        {
          description: 'All registered accounts.',
          icon: UserGroupIcon,
          label: 'Total users',
          value: query.data.totalUsers.toLocaleString(),
        },
        {
          description: 'Accounts with administrator access.',
          icon: UserShield01Icon,
          label: 'Administrators',
          value: query.data.totalAdmins.toLocaleString(),
        },
        {
          description: 'Accounts created during the last seven days.',
          icon: UserAdd01Icon,
          label: 'New in 7 days',
          value: query.data.newUsersLast7Days.toLocaleString(),
        },
      ]}
    />
  )
}
