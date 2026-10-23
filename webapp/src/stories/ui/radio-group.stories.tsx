import type { Meta, StoryObj } from '@storybook/react-vite'

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { DemoSurface } from './demo-surface'

const meta = {
  component: RadioGroupDemo,
  title: 'UI/Inputs/Radio Group',
} satisfies Meta<typeof RadioGroupDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function RadioGroupDemo() {
  return (
    <DemoSurface>
      <RadioGroup defaultValue="system" className="grid gap-3">
        {['system', 'light', 'dark'].map((value) => (
          <label className="flex items-center gap-3 text-sm capitalize" key={value}>
            <RadioGroupItem value={value} />
            {value}
          </label>
        ))}
      </RadioGroup>
    </DemoSurface>
  )
}
