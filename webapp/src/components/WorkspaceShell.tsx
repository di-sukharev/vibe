import {
  DashboardSquare01Icon,
  Home01Icon,
  Logout01Icon,
  Settings01Icon,
  UserGroupIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link, useLocation } from '@tanstack/react-router'
import type { UserDto } from '@web-app-demo/contracts'
import type { PropsWithChildren } from 'react'
import { useState } from 'react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Typography } from '@/components/ui/typography'
import {
  homePathForRole,
  navigationItemsForRole,
  type WorkspaceRoutePath,
} from '@/features/navigation'

const iconsByPath = {
  '/app': Home01Icon,
  '/app/profile': UserIcon,
  '/app/settings': Settings01Icon,
  '/admin': DashboardSquare01Icon,
  '/admin/users': UserGroupIcon,
  '/admin/settings': Settings01Icon,
} as const

export function WorkspaceShell({
  children,
  onLogout,
  user,
}: PropsWithChildren<{
  onLogout: () => Promise<void>
  user: UserDto
}>) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const [logoutFailed, setLogoutFailed] = useState(false)
  const title = navigationItemsForRole(user.role).find((item) => item.to === pathname)?.label
    ?? (user.role === 'admin' ? 'Dashboard' : 'Home')

  const logout = async () => {
    setLogoutFailed(false)
    try {
      await onLogout()
    } catch {
      setLogoutFailed(true)
    }
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip="web_app_demo">
                <WorkspaceLink to={homePathForRole(user.role)}>
                  <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Typography variant="control">W</Typography>
                  </span>
                  <span className="grid min-w-0">
                    <Typography variant="control">web_app_demo</Typography>
                    <Typography variant="caption" tone="muted">
                      {user.role === 'admin' ? 'Admin workspace' : 'User workspace'}
                    </Typography>
                  </span>
                </WorkspaceLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <nav aria-label="Primary navigation">
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigationItemsForRole(user.role).map((item) => (
                    <NavigationItem
                      isActive={pathname === item.to}
                      key={item.to}
                      label={item.label}
                      to={item.to}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </nav>
        </SidebarContent>

        <SidebarFooter>
          {logoutFailed && (
            <Typography role="alert" variant="caption" tone="destructive">
              Logout failed. Please try again.
            </Typography>
          )}
          <div className="flex items-center gap-3 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Avatar size="sm">
              <AvatarFallback>{initials(user)}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <Typography variant="control" className="truncate">
                {user.displayName ?? user.email}
              </Typography>
              <Typography variant="caption" tone="muted" className="truncate">
                {user.email}
              </Typography>
            </div>
            <Badge variant="outline" className="capitalize group-data-[collapsible=icon]:hidden">
              {user.role}
            </Badge>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => void logout()}
                tooltip="Logout"
                type="button"
              >
                <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />
                <Typography asChild variant="control">
                  <span>Logout</span>
                </Typography>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <Typography as="span" variant="h6">{title}</Typography>
        </header>
        <div className="flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function NavigationItem({
  isActive,
  label,
  to,
}: {
  isActive: boolean
  label: string
  to: WorkspaceRoutePath
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <WorkspaceLink to={to}>
          <HugeiconsIcon icon={iconsByPath[to]} strokeWidth={2} />
          <Typography asChild variant="control">
            <span>{label}</span>
          </Typography>
        </WorkspaceLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function WorkspaceLink({
  children,
  to,
}: PropsWithChildren<{ to: WorkspaceRoutePath }>) {
  const { setOpenMobile } = useSidebar()
  return (
    <Link onClick={() => setOpenMobile(false)} to={to}>
      {children}
    </Link>
  )
}

function initials(user: UserDto) {
  const source = user.displayName ?? user.email
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}
