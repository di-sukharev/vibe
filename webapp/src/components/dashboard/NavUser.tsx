import {
  Logout01Icon,
  MoreVerticalCircle01Icon,
  Settings01Icon,
  UserCircle02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { UserDto } from '@web-app-demo/contracts'
import { useState } from 'react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Typography } from '@/components/ui/typography'
import type { WorkspaceRoutePath } from '@/features/navigation'
import { DashboardLink } from './DashboardLink'

export function NavUser({
  accountPath,
  onLogout,
  settingsPath,
  user,
}: {
  accountPath?: WorkspaceRoutePath
  onLogout: () => Promise<void>
  settingsPath: WorkspaceRoutePath
  user: UserDto
}) {
  const { isMobile, setOpen } = useSidebar()
  const [logoutError, setLogoutError] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)

  const logout = async () => {
    setLogoutError(false)
    setLogoutPending(true)
    try {
      await onLogout()
    } catch {
      setLogoutError(true)
      setOpen(true)
    } finally {
      setLogoutPending(false)
    }
  }

  return (
    <>
      {logoutError && (
        <Typography role="alert" variant="caption" tone="destructive">
          Logout failed. Please try again.
        </Typography>
      )}
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                aria-label="Open account menu"
                size="lg"
                tooltip={user.displayName ?? user.email}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {userInitials(user)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 gap-0.5 text-left">
                  <Typography variant="control" truncate>
                    {user.displayName ?? user.email}
                  </Typography>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Typography variant="caption" tone="muted" truncate>
                      {user.email}
                    </Typography>
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {user.role}
                    </Badge>
                  </div>
                </div>
                <HugeiconsIcon
                  className="ml-auto size-4 group-data-[collapsible=icon]:hidden"
                  icon={MoreVerticalCircle01Icon}
                  strokeWidth={2}
                />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-56 rounded-lg"
              side={isMobile ? 'bottom' : 'right'}
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0">
                <div className="flex items-center gap-2 px-1 py-1.5">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">
                      {userInitials(user)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <Typography variant="bodySmMedium" truncate>
                      {user.displayName ?? user.email}
                    </Typography>
                    <Typography variant="caption" tone="muted" truncate>
                      {user.email}
                    </Typography>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {accountPath && (
                  <DropdownMenuItem asChild>
                    <DashboardLink to={accountPath}>
                      <HugeiconsIcon icon={UserCircle02Icon} strokeWidth={2} />
                      Account
                    </DashboardLink>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <DashboardLink to={settingsPath}>
                    <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />
                    Settings
                  </DashboardLink>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={logoutPending}
                onSelect={() => void logout()}
                variant="destructive"
              >
                <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />
                {logoutPending ? 'Logging out…' : 'Log out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}

function userInitials(user: UserDto) {
  return (user.displayName ?? user.email)
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}
