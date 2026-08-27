import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['empty'],
  title: 'UI/Feedback/Empty',
} satisfies Meta<typeof uiDemos['empty']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
