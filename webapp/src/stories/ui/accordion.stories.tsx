import type { Meta, StoryObj } from '@storybook/react-vite'

import { uiDemos } from './demos'

const meta = {
  component: uiDemos['accordion'],
  title: 'UI/Navigation/Accordion',
} satisfies Meta<typeof uiDemos['accordion']>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
