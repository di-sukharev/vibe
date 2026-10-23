import type { Meta, StoryObj } from '@storybook/react-vite'

import { Badge } from '@/components/ui/badge'
import { DemoSurface } from './demo-surface'

const meta = {
  component: BadgeDemo,
  title: 'UI/Data Display/Badge',
} satisfies Meta<typeof BadgeDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function BadgeDemo() {
  return (
    <DemoSurface>
      <div className="flex flex-wrap gap-2">
        {(['default', 'secondary', 'outline', 'destructive', 'ghost', 'link'] as const).map(
          (variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ),
        )}
      </div>
    </DemoSurface>
  )
}
