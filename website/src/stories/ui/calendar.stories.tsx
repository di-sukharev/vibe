import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['calendar'],
  title: 'UI/Data Display/Calendar',
} satisfies Meta<typeof uiDemos['calendar']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
