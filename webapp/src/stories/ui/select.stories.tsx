import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from '@/components/ui/select'
import { DemoSurface } from './demo-surface'

const options = ['Design', 'Engineering', 'Product']

const meta = {
  component: SelectDemo,
  title: 'UI/Inputs/Select',
} satisfies Meta<typeof SelectDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
}

function SelectDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <Select
        defaultOpen={defaultOpen}
        defaultValue="product"
        items={options.map((label) => ({ label, value: label.toLowerCase() }))}
      >
        <SelectTrigger aria-label="Team" className="w-64" tabIndex={defaultOpen ? -1 : undefined}>
          <SelectValue placeholder="Choose a team" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Teams</SelectLabel>
            {options.map((option) => (
              <SelectItem key={option} value={option.toLowerCase()}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </DemoSurface>
  )
}
