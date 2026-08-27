import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['button-group'],
  title: 'UI/Inputs/Button Group',
} satisfies Meta<typeof uiDemos['button-group']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
