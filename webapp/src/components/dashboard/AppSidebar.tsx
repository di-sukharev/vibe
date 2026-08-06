import type { UserDto } from '@web-app-demo/contracts'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { Typography } from '@/components/typography'
import type { WorkspaceRoutePath } from '@/features/navigation'
import { DashboardLink } from './DashboardLink'
import { NavMain, type DashboardNavigationItem } from './NavMain'
import { NavUser } from './NavUser'

export function AppSidebar({
  accountPath,
  homePath,
  items,
  onLogout,
  settingsPath,
  user,
  workspaceLabel,
}: {
  accountPath?: WorkspaceRoutePath
  homePath: WorkspaceRoutePath
  items: ReadonlyArray<DashboardNavigationItem>
  onLogout: () => Promise<void>
  settingsPath: WorkspaceRoutePath
  user: UserDto
  workspaceLabel: string
}) {
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="web_app_demo">
              <DashboardLink to={homePath}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Typography variant="control">W</Typography>
                </span>
                <span className="grid min-w-0 gap-0.5 group-data-[collapsible=icon]:hidden">
                  <Typography variant="control" truncate>
                    web_app_demo
                  </Typography>
                  <Typography variant="caption" tone="muted" truncate>
                    {workspaceLabel}
                  </Typography>
                </span>
              </DashboardLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          accountPath={accountPath}
          onLogout={onLogout}
          settingsPath={settingsPath}
          user={user}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
