import type { Meta, StoryObj } from '@storybook/react-vite'

import { Input } from '@/components/ui/input'
import { DemoSurface } from './demo-surface'

const meta = {
  component: InputDemo,
  title: 'UI/Inputs/Input',
} satisfies Meta<typeof InputDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function InputDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-3">
        <Input aria-label="Default input" placeholder="Default input" />
        <Input aria-invalid aria-label="Invalid input" defaultValue="Invalid value" />
        <Input aria-label="Disabled input" disabled placeholder="Disabled input" />
      </div>
    </DemoSurface>
  )
}
