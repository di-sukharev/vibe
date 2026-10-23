import type { Meta, StoryObj } from '@storybook/react-vite'

import { DirectionProvider } from '@/components/ui/direction'
import { DemoSurface } from './demo-surface'

const meta = {
  component: DirectionDemo,
  title: 'UI/Layout/Direction',
} satisfies Meta<typeof DirectionDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function DirectionDemo() {
  return (
    <DemoSurface>
      <DirectionProvider direction="rtl">
        <div dir="rtl" className="rounded-lg border p-4 text-sm">
          واجهة من اليمين إلى اليسار
        </div>
      </DirectionProvider>
    </DemoSurface>
  )
}
