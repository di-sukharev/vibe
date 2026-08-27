import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['resizable'],
  title: 'UI/Layout/Resizable',
} satisfies Meta<typeof uiDemos['resizable']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
