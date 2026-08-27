import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['avatar'],
  title: 'UI/Data Display/Avatar',
} satisfies Meta<typeof uiDemos['avatar']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
