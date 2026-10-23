import type { Meta, StoryObj } from '@storybook/react-vite'

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { DemoSurface } from './demo-surface'

const meta = {
  component: NativeSelectDemo,
  title: 'UI/Inputs/Native Select',
} satisfies Meta<typeof NativeSelectDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function NativeSelectDemo() {
  return (
    <DemoSurface>
      <NativeSelect defaultValue="product" aria-label="Team">
        <NativeSelectOption value="design">Design</NativeSelectOption>
        <NativeSelectOption value="engineering">Engineering</NativeSelectOption>
        <NativeSelectOption value="product">Product</NativeSelectOption>
      </NativeSelect>
    </DemoSurface>
  )
}
