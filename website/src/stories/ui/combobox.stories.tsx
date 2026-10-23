import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
} from '@/components/ui/combobox'
import { DemoSurface } from './demo-surface'

const options = ['Design', 'Engineering', 'Product']

const meta = {
  component: ComboboxDemo,
  title: 'UI/Inputs/Combobox',
} satisfies Meta<typeof ComboboxDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ComboboxDemo() {
  return (
    <DemoSurface>
      <Combobox items={options}>
        <ComboboxInput className="w-64" placeholder="Choose a team" showClear />
        <ComboboxContent>
          <ComboboxEmpty>No team found.</ComboboxEmpty>
          <ComboboxList>
            {options.map((option) => (
              <ComboboxItem key={option} value={option}>
                {option}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </DemoSurface>
  )
}
