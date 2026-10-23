import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/components/ui/button'
import { DemoSurface } from './demo-surface'

const meta = {
  component: ButtonDemo,
  title: 'UI/Inputs/Button',
} satisfies Meta<typeof ButtonDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ButtonDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map(
            (variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ),
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['xs', 'sm', 'default', 'lg'] as const).map((size) => (
            <Button key={size} size={size}>
              {size}
            </Button>
          ))}
          <Button disabled>Disabled</Button>
        </div>
      </div>
    </DemoSurface>
  )
}
