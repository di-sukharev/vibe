import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['separator'],
  title: 'UI/Layout/Separator',
} satisfies Meta<typeof uiDemos['separator']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
