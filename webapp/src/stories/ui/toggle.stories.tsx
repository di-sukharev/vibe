import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['toggle'],
  title: 'UI/Inputs/Toggle',
} satisfies Meta<typeof uiDemos['toggle']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
