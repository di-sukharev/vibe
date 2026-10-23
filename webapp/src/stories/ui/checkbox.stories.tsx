import type { Meta, StoryObj } from '@storybook/react-vite'

import { Checkbox } from '@/components/ui/checkbox'
import { DemoSurface } from './demo-surface'

const meta = {
  component: CheckboxDemo,
  title: 'UI/Inputs/Checkbox',
} satisfies Meta<typeof CheckboxDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function CheckboxDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-4">
        <label className="flex items-center gap-3 text-sm">
          <Checkbox defaultChecked />
          Selected
        </label>
        <label className="flex items-center gap-3 text-sm">
          <Checkbox />
          Unselected
        </label>
        <label className="flex items-center gap-3 text-sm opacity-60">
          <Checkbox disabled />
          Disabled
        </label>
        <label className="flex items-center gap-3 text-sm text-destructive">
          <Checkbox aria-invalid />
          Invalid
        </label>
      </div>
    </DemoSurface>
  )
}
