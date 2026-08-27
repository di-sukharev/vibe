import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['checkbox'],
  title: 'UI/Inputs/Checkbox',
} satisfies Meta<typeof uiDemos['checkbox']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
