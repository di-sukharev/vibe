import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['aspect-ratio'],
  title: 'UI/Layout/Aspect Ratio',
} satisfies Meta<typeof uiDemos['aspect-ratio']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
