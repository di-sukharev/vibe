import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['pagination'],
  title: 'UI/Navigation/Pagination',
} satisfies Meta<typeof uiDemos['pagination']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
