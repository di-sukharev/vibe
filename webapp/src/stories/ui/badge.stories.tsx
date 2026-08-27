import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['badge'],
  title: 'UI/Data Display/Badge',
} satisfies Meta<typeof uiDemos['badge']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
