import type { Meta, StoryObj } from '@storybook/react-vite'

import { Marker, MarkerIcon, MarkerContent } from '@/components/ui/marker'
import { DemoSurface } from './demo-surface'

const meta = {
  component: MarkerDemo,
  title: 'UI/Messaging/Marker',
} satisfies Meta<typeof MarkerDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function MarkerDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-5">
        <Marker>
          <MarkerIcon>●</MarkerIcon>
          <MarkerContent>Today</MarkerContent>
        </Marker>
        <Marker variant="separator">
          <MarkerContent>3 unread messages</MarkerContent>
        </Marker>
        <Marker variant="border">
          <MarkerContent>Latest activity</MarkerContent>
        </Marker>
      </div>
    </DemoSurface>
  )
}
