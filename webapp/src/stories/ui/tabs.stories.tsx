import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['tabs'],
  title: 'UI/Navigation/Tabs',
} satisfies Meta<typeof uiDemos['tabs']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
