import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['message'],
  title: 'UI/Messaging/Message',
} satisfies Meta<typeof uiDemos['message']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
