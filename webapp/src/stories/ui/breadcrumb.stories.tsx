import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['breadcrumb'],
  title: 'UI/Navigation/Breadcrumb',
} satisfies Meta<typeof uiDemos['breadcrumb']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
