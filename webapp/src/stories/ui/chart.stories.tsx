import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['chart'],
  title: 'UI/Data Display/Chart',
} satisfies Meta<typeof uiDemos['chart']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
