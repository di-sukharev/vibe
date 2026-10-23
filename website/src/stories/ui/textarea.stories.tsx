import type { Meta, StoryObj } from '@storybook/react-vite'

import { Textarea } from '@/components/ui/textarea'
import { DemoSurface } from './demo-surface'

const meta = {
  component: TextareaDemo,
  title: 'UI/Inputs/Textarea',
} satisfies Meta<typeof TextareaDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function TextareaDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-3">
        <Textarea aria-label="Description" placeholder="Write a short description" />
        <Textarea aria-invalid aria-label="Invalid description" defaultValue="Invalid content" />
        <Textarea aria-label="Disabled description" disabled placeholder="Disabled" />
      </div>
    </DemoSurface>
  )
}
