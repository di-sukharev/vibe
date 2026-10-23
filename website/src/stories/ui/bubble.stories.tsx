import type { Meta, StoryObj } from '@storybook/react-vite'

import { BubbleGroup, Bubble, BubbleContent, BubbleReactions } from '@/components/ui/bubble'
import { DemoSurface } from './demo-surface'

const meta = {
  component: BubbleDemo,
  title: 'UI/Messaging/Bubble',
} satisfies Meta<typeof BubbleDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function BubbleDemo() {
  return (
    <DemoSurface>
      <BubbleGroup>
        <Bubble variant="muted">
          <BubbleContent>How should this component behave on mobile?</BubbleContent>
        </Bubble>
        <Bubble align="end">
          <BubbleContent>Keep the controls reachable and let long text wrap.</BubbleContent>
          <BubbleReactions>👍 3</BubbleReactions>
        </Bubble>
        <Bubble variant="destructive">
          <BubbleContent>The message could not be sent.</BubbleContent>
        </Bubble>
      </BubbleGroup>
    </DemoSurface>
  )
}
