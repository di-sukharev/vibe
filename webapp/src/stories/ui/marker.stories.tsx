import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['marker'],
  title: 'UI/Messaging/Marker',
} satisfies Meta<typeof uiDemos['marker']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
