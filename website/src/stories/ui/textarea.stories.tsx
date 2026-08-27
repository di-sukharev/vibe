import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['textarea'],
  title: 'UI/Inputs/Textarea',
} satisfies Meta<typeof uiDemos['textarea']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
