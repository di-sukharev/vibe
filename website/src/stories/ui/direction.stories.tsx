import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['direction'],
  title: 'UI/Layout/Direction',
} satisfies Meta<typeof uiDemos['direction']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
