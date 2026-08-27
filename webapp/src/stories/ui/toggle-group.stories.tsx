import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['toggle-group'],
  title: 'UI/Inputs/Toggle Group',
} satisfies Meta<typeof uiDemos['toggle-group']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
