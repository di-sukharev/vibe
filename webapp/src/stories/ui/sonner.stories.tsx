import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['sonner'],
  title: 'UI/Feedback/Sonner',
} satisfies Meta<typeof uiDemos['sonner']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
