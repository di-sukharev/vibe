import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty'
import { DemoSurface } from './demo-surface'

const meta = {
  component: EmptyDemo,
  title: 'UI/Feedback/Empty',
} satisfies Meta<typeof EmptyDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function EmptyDemo() {
  return (
    <DemoSurface>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">∅</EmptyMedia>
          <EmptyTitle>No projects yet</EmptyTitle>
          <EmptyDescription>Create the first project to start working.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button>Create project</Button>
        </EmptyContent>
      </Empty>
    </DemoSurface>
  )
}
