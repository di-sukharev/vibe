import type { Meta, StoryObj } from '@storybook/react-vite'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  MessageGroup,
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
  MessageFooter,
} from '@/components/ui/message'
import { DemoSurface } from './demo-surface'

const meta = {
  component: MessageDemo,
  title: 'UI/Messaging/Message',
} satisfies Meta<typeof MessageDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function MessageDemo() {
  return (
    <DemoSurface>
      <MessageGroup>
        <Message>
          <MessageAvatar>AI</MessageAvatar>
          <MessageContent>
            <MessageHeader>Assistant · now</MessageHeader>
            <Bubble variant="muted">
              <BubbleContent>I prepared the component inventory.</BubbleContent>
            </Bubble>
            <MessageFooter>Delivered</MessageFooter>
          </MessageContent>
        </Message>
        <Message align="end">
          <MessageAvatar>DS</MessageAvatar>
          <MessageContent>
            <Bubble align="end">
              <BubbleContent>Show me the responsive states too.</BubbleContent>
            </Bubble>
            <MessageFooter>Read</MessageFooter>
          </MessageContent>
        </Message>
      </MessageGroup>
    </DemoSurface>
  )
}
