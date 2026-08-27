import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['table'],
  title: 'UI/Data Display/Table',
} satisfies Meta<typeof uiDemos['table']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
