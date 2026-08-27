import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['collapsible'],
  title: 'UI/Layout/Collapsible',
} satisfies Meta<typeof uiDemos['collapsible']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
