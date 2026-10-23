import type { Meta, StoryObj } from '@storybook/react-vite'

import { Separator } from '@/components/ui/separator'
import { DemoSurface } from './demo-surface'

const meta = {
  component: SeparatorDemo,
  title: 'UI/Layout/Separator',
} satisfies Meta<typeof SeparatorDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function SeparatorDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-4">
        <div>
          <strong>Design system</strong>
          <p className="text-sm text-muted-foreground">A consistent component language.</p>
        </div>
        <Separator />
        <div className="flex h-5 items-center gap-4 text-sm">
          <span>Overview</span>
          <Separator orientation="vertical" />
          <span>Components</span>
          <Separator orientation="vertical" />
          <span>Patterns</span>
        </div>
      </div>
    </DemoSurface>
  )
}
