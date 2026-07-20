import {
  Calendar03Icon,
  CreditCardIcon,
  UserCircle02Icon,
} from '@hugeicons/core-free-icons'
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
          description: subscriptionDescription(user.subscription),
          icon: CreditCardIcon,
          label: 'Subscription',
          value: `${formatWords(user.subscription.entitlement)} · ${formatWords(user.subscription.state)}`,
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

function formatWords(value: string) {
  const words = value.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function subscriptionDescription(subscription: UserDto['subscription']) {
  const platform =
    subscription.platform === 'ios'
      ? 'iOS'
      : subscription.platform === 'android'
        ? 'Android'
        : null

  if (platform && subscription.productId) {
    return `${platform} · ${subscription.productId}`
  }
  if (platform) return `${platform} store subscription`
  if (subscription.productId) return subscription.productId
  return subscription.isActive
    ? 'Premium access is active.'
    : 'No store subscription is currently linked.'
}
