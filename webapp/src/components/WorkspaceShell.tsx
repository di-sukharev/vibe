import {
  DashboardSquare01Icon,
  Home01Icon,
  Settings01Icon,
  UserGroupIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { useLocation } from '@tanstack/react-router'
import type { UserDto } from '@web-app-demo/contracts'
import type { PropsWithChildren } from 'react'

import {
  AppSidebar,
  type DashboardNavigationItem,
  SiteHeader,
} from '@/components/dashboard'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import {
  homePathForRole,
  navigationItemsForRole,
} from '@/features/navigation'

const iconsByPath = {
  '/app': Home01Icon,
  '/app/profile': UserIcon,
  '/app/settings': Settings01Icon,
  '/admin': DashboardSquare01Icon,
  '/admin/users': UserGroupIcon,
  '/admin/settings': Settings01Icon,
} as const

function getSidebarDefaultOpen() {
  const persistedState = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('sidebar_state='))
    ?.slice('sidebar_state='.length)

  return persistedState !== 'false'
}

export function WorkspaceShell({
  children,
  onLogout,
  user,
}: PropsWithChildren<{
  onLogout: () => Promise<void>
  user: UserDto
}>) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigationItems = navigationItemsForRole(user.role)
  const activeItem = navigationItems.find((item) => item.to === pathname)
  const homePath = homePathForRole(user.role)
  const settingsPath = user.role === 'admin' ? '/admin/settings' : '/app/settings'
  const items: ReadonlyArray<DashboardNavigationItem> = navigationItems.map((item) => ({
    ...item,
    icon: iconsByPath[item.to],
    isActive: item.to === pathname,
  }))

  return (
    <SidebarProvider defaultOpen={getSidebarDefaultOpen()}>
      <AppSidebar
        accountPath={user.role === 'user' ? '/app/profile' : undefined}
        homePath={homePath}
        items={items}
        onLogout={onLogout}
        settingsPath={settingsPath}
        user={user}
        workspaceLabel={user.role === 'admin' ? 'Admin workspace' : 'User workspace'}
      />
      <SidebarInset>
        <SiteHeader
          title={activeItem?.label ?? (user.role === 'admin' ? 'Dashboard' : 'Home')}
        />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
