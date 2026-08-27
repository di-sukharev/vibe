import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['switch'],
  title: 'UI/Inputs/Switch',
} satisfies Meta<typeof uiDemos['switch']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
