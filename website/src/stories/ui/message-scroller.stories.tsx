import type { Meta, StoryObj } from '@storybook/react-vite'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from '@/components/ui/message-scroller'
import { DemoSurface } from './demo-surface'

const meta = {
  component: MessageScrollerDemo,
  title: 'UI/Messaging/Message Scroller',
} satisfies Meta<typeof MessageScrollerDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function MessageScrollerDemo() {
  return (
    <DemoSurface>
      <MessageScrollerProvider>
        <MessageScroller className="h-72 rounded-xl border">
          <MessageScrollerViewport>
            <MessageScrollerContent className="p-4">
              {Array.from({ length: 10 }, (_, index) => (
                <MessageScrollerItem key={index} scrollAnchor={index === 9}>
                  <Bubble
                    align={index % 2 ? 'end' : 'start'}
                    variant={index % 2 ? 'default' : 'muted'}
                  >
                    <BubbleContent>Conversation message {index + 1}</BubbleContent>
                  </Bubble>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </DemoSurface>
  )
}
