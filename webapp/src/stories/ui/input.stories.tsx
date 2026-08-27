import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['input'],
  title: 'UI/Inputs/Input',
} satisfies Meta<typeof uiDemos['input']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
