import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['alert'],
  title: 'UI/Feedback/Alert',
} satisfies Meta<typeof uiDemos['alert']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
