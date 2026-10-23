import type { Meta, StoryObj } from '@storybook/react-vite'

import { Spinner } from '@/components/ui/spinner'
import { DemoSurface } from './demo-surface'

const meta = {
  component: SpinnerDemo,
  title: 'UI/Feedback/Spinner',
} satisfies Meta<typeof SpinnerDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function SpinnerDemo() {
  return (
    <DemoSurface>
      <div className="flex items-center gap-3 text-sm">
        <Spinner />
        Loading workspace…
      </div>
    </DemoSurface>
  )
}
