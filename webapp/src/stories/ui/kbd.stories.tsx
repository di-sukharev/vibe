import type { Meta, StoryObj } from '@storybook/react-vite'

import { KbdGroup, Kbd } from '@/components/ui/kbd'
import { DemoSurface } from './demo-surface'

const meta = {
  component: KbdDemo,
  title: 'UI/Data Display/Kbd',
} satisfies Meta<typeof KbdDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function KbdDemo() {
  return (
    <DemoSurface>
      <div className="flex items-center gap-2 text-sm">
        Open command palette{' '}
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </div>
    </DemoSurface>
  )
}
