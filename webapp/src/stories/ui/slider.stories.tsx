import type { Meta, StoryObj } from '@storybook/react-vite'

import { Slider } from '@/components/ui/slider'
import { DemoSurface } from './demo-surface'

const meta = {
  component: SliderDemo,
  title: 'UI/Inputs/Slider',
} satisfies Meta<typeof SliderDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function SliderDemo() {
  return (
    <DemoSurface>
      <Slider defaultValue={[25, 75]} max={100} step={1} aria-label="Range" />
    </DemoSurface>
  )
}
