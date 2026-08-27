import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['message-scroller'],
  title: 'UI/Messaging/Message Scroller',
} satisfies Meta<typeof uiDemos['message-scroller']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
