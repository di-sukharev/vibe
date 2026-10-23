import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { DemoSurface } from './demo-surface'

const meta = {
  component: TooltipDemo,
  title: 'UI/Overlays/Tooltip',
} satisfies Meta<typeof TooltipDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
}

function TooltipDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <Tooltip defaultOpen={defaultOpen}>
        <TooltipTrigger render={<Button variant="outline" />}>Hover or focus</TooltipTrigger>
        <TooltipContent>Keyboard shortcut: ⌘K</TooltipContent>
      </Tooltip>
    </DemoSurface>
  )
}
