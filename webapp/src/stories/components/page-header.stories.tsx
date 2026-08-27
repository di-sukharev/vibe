import type { Meta, StoryObj } from '@storybook/react-vite'

import { PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'

const meta = {
  component: PageHeader,
  title: 'Components/Page Header',
  args: {
    description: 'A concise explanation of the work available on this page.',
    title: 'Workspace overview',
  },
} satisfies Meta<typeof PageHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithAction: Story = {
  args: {
    actions: <Button>Create project</Button>,
  },
}
