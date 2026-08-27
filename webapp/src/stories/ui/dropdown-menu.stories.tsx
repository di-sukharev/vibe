import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['dropdown-menu'],
  title: 'UI/Overlays/Dropdown Menu',
} satisfies Meta<typeof uiDemos['dropdown-menu']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
}
