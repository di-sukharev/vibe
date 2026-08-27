import type { Meta, StoryObj } from '@storybook/react-vite'

import { SectionCards } from '@/components/dashboard'

const meta = {
  component: SectionCards,
  title: 'Components/Section Cards',
  args: {
    items: [
      { label: 'Active projects', value: 12, description: '+3 this month' },
      { label: 'Team members', value: 28, description: '4 invited' },
      { label: 'Tasks completed', value: '84%', description: 'Last 30 days' },
    ],
  },
} satisfies Meta<typeof SectionCards>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const SingleMetric: Story = {
  args: {
    items: [{ label: 'Active projects', value: 12, description: '+3 this month' }],
  },
}
