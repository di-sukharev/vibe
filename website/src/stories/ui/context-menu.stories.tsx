import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { DemoSurface } from './demo-surface'

const meta = {
  component: ContextMenuDemo,
  title: 'UI/Overlays/Context Menu',
} satisfies Meta<typeof ContextMenuDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ContextMenuDemo() {
  return (
    <DemoSurface>
      <ContextMenu>
        <ContextMenuTrigger className="grid h-40 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
          Right-click this area
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Open</ContextMenuItem>
          <ContextMenuItem>
            Duplicate<ContextMenuShortcut>⌘D</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </DemoSurface>
  )
}
