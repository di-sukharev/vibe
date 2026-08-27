import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['input-group'],
  title: 'UI/Inputs/Input Group',
} satisfies Meta<typeof uiDemos['input-group']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
