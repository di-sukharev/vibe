import type { Meta, StoryObj } from '@storybook/react-vite'

import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { DemoSurface } from './demo-surface'

const meta = {
  component: ScrollAreaDemo,
  title: 'UI/Layout/Scroll Area',
} satisfies Meta<typeof ScrollAreaDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ScrollAreaDemo() {
  return (
    <DemoSurface>
      <ScrollArea className="h-48 rounded-xl border">
        <div className="grid gap-3 p-4">
          {Array.from({ length: 12 }, (_, index) => (
            <div className="border-b pb-3 text-sm" key={index}>
              Scrollable item {index + 1}
            </div>
          ))}
        </div>
        <ScrollBar />
      </ScrollArea>
    </DemoSurface>
  )
}
