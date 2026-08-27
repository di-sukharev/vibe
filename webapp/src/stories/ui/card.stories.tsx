import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['card'],
  title: 'UI/Data Display/Card',
} satisfies Meta<typeof uiDemos['card']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
