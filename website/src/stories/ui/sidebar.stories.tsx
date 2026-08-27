import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['sidebar'],
  title: 'UI/Navigation/Sidebar',
} satisfies Meta<typeof uiDemos['sidebar']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
