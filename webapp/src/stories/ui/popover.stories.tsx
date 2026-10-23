import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from '@/components/ui/popover'
import { DemoSurface } from './demo-surface'

const meta = {
  component: PopoverDemo,
  title: 'UI/Overlays/Popover',
} satisfies Meta<typeof PopoverDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
}

function PopoverDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <Popover defaultOpen={defaultOpen}>
        <PopoverTrigger render={<Button variant="outline" />}>Open popover</PopoverTrigger>
        <PopoverContent aria-label="Card dimensions">
          <PopoverHeader>
            <PopoverTitle>Dimensions</PopoverTitle>
            <PopoverDescription>Set the preferred card width.</PopoverDescription>
          </PopoverHeader>
          <Input type="number" defaultValue="320" aria-label="Width" />
        </PopoverContent>
      </Popover>
    </DemoSurface>
  )
}
