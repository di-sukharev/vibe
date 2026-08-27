import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['native-select'],
  title: 'UI/Inputs/Native Select',
} satisfies Meta<typeof uiDemos['native-select']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
