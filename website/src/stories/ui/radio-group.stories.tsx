import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['radio-group'],
  title: 'UI/Inputs/Radio Group',
} satisfies Meta<typeof uiDemos['radio-group']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
