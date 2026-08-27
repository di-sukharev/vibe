import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['label'],
  title: 'UI/Inputs/Label',
} satisfies Meta<typeof uiDemos['label']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
