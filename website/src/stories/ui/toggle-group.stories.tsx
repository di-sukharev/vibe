import type { Meta, StoryObj } from '@storybook/react-vite'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DemoSurface } from './demo-surface'

const meta = {
  component: ToggleGroupDemo,
  title: 'UI/Inputs/Toggle Group',
} satisfies Meta<typeof ToggleGroupDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ToggleGroupDemo() {
  return (
    <DemoSurface>
      <ToggleGroup multiple variant="outline" spacing={0} defaultValue={['left']}>
        <ToggleGroupItem value="left">Left</ToggleGroupItem>
        <ToggleGroupItem value="center">Center</ToggleGroupItem>
        <ToggleGroupItem value="right">Right</ToggleGroupItem>
      </ToggleGroup>
    </DemoSurface>
  )
}
