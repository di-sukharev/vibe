import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { DemoSurface } from './demo-surface'

const meta = {
  component: CollapsibleDemo,
  title: 'UI/Layout/Collapsible',
} satisfies Meta<typeof CollapsibleDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function CollapsibleDemo() {
  return (
    <DemoSurface>
      <Collapsible className="grid gap-2" defaultOpen>
        <CollapsibleTrigger render={<Button variant="outline" />}>
          Toggle details
        </CollapsibleTrigger>
        <CollapsibleContent className="rounded-lg border bg-muted/40 p-4 text-sm">
          Additional content stays grouped with its trigger.
        </CollapsibleContent>
      </Collapsible>
    </DemoSurface>
  )
}
