import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['button'],
  title: 'UI/Inputs/Button',
} satisfies Meta<typeof uiDemos['button']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
