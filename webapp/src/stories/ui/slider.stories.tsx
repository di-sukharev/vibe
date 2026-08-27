import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['slider'],
  title: 'UI/Inputs/Slider',
} satisfies Meta<typeof uiDemos['slider']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
