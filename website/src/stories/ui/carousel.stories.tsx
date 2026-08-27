import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['carousel'],
  title: 'UI/Data Display/Carousel',
} satisfies Meta<typeof uiDemos['carousel']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
