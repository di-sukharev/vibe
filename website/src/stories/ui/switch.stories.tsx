import type { Meta, StoryObj } from '@storybook/react-vite'

import { Switch } from '@/components/ui/switch'
import { DemoSurface } from './demo-surface'

const meta = {
  component: SwitchDemo,
  title: 'UI/Inputs/Switch',
} satisfies Meta<typeof SwitchDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function SwitchDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-4">
        <label className="flex items-center gap-3 text-sm">
          <Switch defaultChecked />
          Notifications
        </label>
        <label className="flex items-center gap-3 text-sm">
          <Switch size="sm" />
          Compact control
        </label>
        <label className="flex items-center gap-3 text-sm opacity-60">
          <Switch disabled />
          Disabled
        </label>
      </div>
    </DemoSurface>
  )
}
