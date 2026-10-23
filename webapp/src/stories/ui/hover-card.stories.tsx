import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card'
import { DemoSurface } from './demo-surface'

const meta = {
  component: HoverCardDemo,
  title: 'UI/Overlays/Hover Card',
} satisfies Meta<typeof HoverCardDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
}

function HoverCardDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <HoverCard defaultOpen={defaultOpen}>
        <HoverCardTrigger render={<Button variant="link" />}>@design-system</HoverCardTrigger>
        <HoverCardContent>
          <div className="grid gap-1">
            <strong>Design system</strong>
            <span className="text-sm text-muted-foreground">
              Shared components and interaction rules.
            </span>
          </div>
        </HoverCardContent>
      </HoverCard>
    </DemoSurface>
  )
}
