import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['menubar'],
  title: 'UI/Navigation/Menubar',
} satisfies Meta<typeof uiDemos['menubar']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
