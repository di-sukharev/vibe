import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['scroll-area'],
  title: 'UI/Layout/Scroll Area',
} satisfies Meta<typeof uiDemos['scroll-area']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
