import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarInput,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarRail,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar'

const meta = {
  component: SidebarDemo,
  title: 'UI/Navigation/Sidebar',
} satisfies Meta<typeof SidebarDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function SidebarDemo() {
  return (
    <div className="h-[34rem] overflow-hidden rounded-xl border">
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon" variant="inset">
          <SidebarHeader>
            <SidebarInput placeholder="Search" />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {['Overview', 'Projects', 'Settings'].map((label, index) => (
                    <SidebarMenuItem key={label}>
                      <SidebarMenuButton isActive={index === 0}>
                        <span>{label.slice(0, 1)}</span>
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <span className="px-2 text-xs text-muted-foreground">Storybook user</span>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <header className="flex h-14 items-center gap-3 border-b px-4">
            <SidebarTrigger />
            <strong>Overview</strong>
          </header>
          <div className="p-6 text-sm text-muted-foreground">
            Resize the viewport to inspect desktop and mobile behavior.
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
