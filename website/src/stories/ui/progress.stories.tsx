import type { Meta, StoryObj } from '@storybook/react-vite'

import { Progress } from '@/components/ui/progress'
import { DemoSurface } from './demo-surface'

const meta = {
  component: ProgressDemo,
  title: 'UI/Feedback/Progress',
} satisfies Meta<typeof ProgressDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ProgressDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-3">
        <Progress value={68} aria-label="68 percent complete" />
        <span className="text-sm text-muted-foreground">68% complete</span>
      </div>
    </DemoSurface>
  )
}
