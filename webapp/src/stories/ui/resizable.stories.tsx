import type { Meta, StoryObj } from '@storybook/react-vite'

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { DemoSurface } from './demo-surface'

const meta = {
  component: ResizableDemo,
  title: 'UI/Layout/Resizable',
} satisfies Meta<typeof ResizableDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ResizableDemo() {
  return (
    <DemoSurface>
      <ResizablePanelGroup
        className="h-48 overflow-hidden rounded-xl border"
        orientation="horizontal"
      >
        <ResizablePanel defaultSize="35%">
          <div className="grid size-full place-items-center bg-muted/40 text-sm">Sidebar</div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>
          <div className="grid size-full place-items-center text-sm">Content</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </DemoSurface>
  )
}
