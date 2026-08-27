import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['skeleton'],
  title: 'UI/Feedback/Skeleton',
} satisfies Meta<typeof uiDemos['skeleton']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
