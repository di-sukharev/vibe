import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['item'],
  title: 'UI/Data Display/Item',
} satisfies Meta<typeof uiDemos['item']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
