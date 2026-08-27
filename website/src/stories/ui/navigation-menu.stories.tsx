import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['navigation-menu'],
  title: 'UI/Navigation/Navigation Menu',
} satisfies Meta<typeof uiDemos['navigation-menu']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
