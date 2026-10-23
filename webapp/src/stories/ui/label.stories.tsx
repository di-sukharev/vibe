import type { Meta, StoryObj } from '@storybook/react-vite'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DemoSurface } from './demo-surface'

const meta = {
  component: LabelDemo,
  title: 'UI/Inputs/Label',
} satisfies Meta<typeof LabelDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function LabelDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-2">
        <Label htmlFor="story-email">Email</Label>
        <Input id="story-email" type="email" placeholder="name@example.com" />
      </div>
    </DemoSurface>
  )
}
