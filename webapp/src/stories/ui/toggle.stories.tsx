import type { Meta, StoryObj } from '@storybook/react-vite'

import { Toggle } from '@/components/ui/toggle'
import { DemoSurface } from './demo-surface'

const meta = {
  component: ToggleDemo,
  title: 'UI/Inputs/Toggle',
} satisfies Meta<typeof ToggleDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ToggleDemo() {
  return (
    <DemoSurface>
      <div className="flex gap-2">
        <Toggle aria-label="Toggle bold">Bold</Toggle>
        <Toggle aria-label="Toggle italic" variant="outline" defaultPressed>
          Italic
        </Toggle>
        <Toggle aria-label="Disabled toggle" disabled>
          Disabled
        </Toggle>
      </div>
    </DemoSurface>
  )
}
