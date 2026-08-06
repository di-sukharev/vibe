import { Calendar03Icon, UserCircle02Icon } from '@hugeicons/core-free-icons'
import type { UserDto } from '@web-app-demo/contracts'

import { SectionCards } from '@/components/dashboard'

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
})

export function AccountSummary({ user }: { user: UserDto }) {
  return (
    <SectionCards
      items={[
        {
          description: user.email,
          icon: UserCircle02Icon,
          label: 'Account',
          value: user.displayName ?? 'No display name',
        },
        {
          description: `Workspace role: ${formatRole(user.role)}`,
          icon: Calendar03Icon,
          label: 'Member since',
          value: dateFormatter.format(new Date(user.createdAt)),
        },
      ]}
    />
  )
}

function formatRole(role: UserDto['role']) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
