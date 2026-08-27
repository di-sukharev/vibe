import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['attachment'],
  title: 'UI/Messaging/Attachment',
} satisfies Meta<typeof uiDemos['attachment']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
