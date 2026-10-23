import type { Meta, StoryObj } from '@storybook/react-vite'

import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { DemoSurface } from './demo-surface'

const meta = {
  component: SonnerDemo,
  title: 'UI/Feedback/Sonner',
} satisfies Meta<typeof SonnerDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function SonnerDemo() {
  return (
    <DemoSurface>
      <Button onClick={() => toast.success('Changes saved')}>Show toast</Button>
      <Toaster />
    </DemoSurface>
  )
}
