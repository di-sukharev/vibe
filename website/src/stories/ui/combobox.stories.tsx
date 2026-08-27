import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['combobox'],
  title: 'UI/Inputs/Combobox',
} satisfies Meta<typeof uiDemos['combobox']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
