import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['bubble'],
  title: 'UI/Messaging/Bubble',
} satisfies Meta<typeof uiDemos['bubble']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
