import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['spinner'],
  title: 'UI/Feedback/Spinner',
} satisfies Meta<typeof uiDemos['spinner']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
