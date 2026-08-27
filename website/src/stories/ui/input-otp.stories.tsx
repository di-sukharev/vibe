import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['input-otp'],
  title: 'UI/Inputs/Input Otp',
} satisfies Meta<typeof uiDemos['input-otp']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
