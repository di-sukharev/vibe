import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['alert-dialog'],
  title: 'UI/Feedback/Alert Dialog',
} satisfies Meta<typeof uiDemos['alert-dialog']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
}
