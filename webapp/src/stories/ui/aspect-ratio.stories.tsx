import type { Meta, StoryObj } from '@storybook/react-vite'

import { AspectRatio } from '@/components/ui/aspect-ratio'
import { DemoSurface } from './demo-surface'

const meta = {
  component: AspectRatioDemo,
  title: 'UI/Layout/Aspect Ratio',
} satisfies Meta<typeof AspectRatioDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function AspectRatioDemo() {
  return (
    <DemoSurface>
      <AspectRatio className="overflow-hidden rounded-xl border bg-muted" ratio={16 / 9}>
        <div className="grid size-full place-items-center text-sm text-foreground">16:9 media</div>
      </AspectRatio>
    </DemoSurface>
  )
}
