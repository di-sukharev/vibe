import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['progress'],
  title: 'UI/Feedback/Progress',
} satisfies Meta<typeof uiDemos['progress']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
