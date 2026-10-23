import type { Meta, StoryObj } from '@storybook/react-vite'

import { Skeleton } from '@/components/ui/skeleton'
import { DemoSurface } from './demo-surface'

const meta = {
  component: SkeletonDemo,
  title: 'UI/Feedback/Skeleton',
} satisfies Meta<typeof SkeletonDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function SkeletonDemo() {
  return (
    <DemoSurface>
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
    </DemoSurface>
  )
}
