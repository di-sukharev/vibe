import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['context-menu'],
  title: 'UI/Overlays/Context Menu',
} satisfies Meta<typeof uiDemos['context-menu']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
