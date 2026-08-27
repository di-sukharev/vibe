import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['command'],
  title: 'UI/Navigation/Command',
} satisfies Meta<typeof uiDemos['command']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
