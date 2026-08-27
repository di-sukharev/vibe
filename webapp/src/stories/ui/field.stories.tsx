import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['field'],
  title: 'UI/Inputs/Field',
} satisfies Meta<typeof uiDemos['field']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
