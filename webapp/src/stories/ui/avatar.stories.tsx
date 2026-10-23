import type { Meta, StoryObj } from '@storybook/react-vite'

import { AvatarGroup, Avatar, AvatarFallback, AvatarGroupCount } from '@/components/ui/avatar'
import { DemoSurface } from './demo-surface'

const meta = {
  component: AvatarDemo,
  title: 'UI/Data Display/Avatar',
} satisfies Meta<typeof AvatarDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function AvatarDemo() {
  return (
    <DemoSurface>
      <AvatarGroup>
        {['DS', 'UI', 'QA'].map((label) => (
          <Avatar key={label} size="lg">
            <AvatarFallback>{label}</AvatarFallback>
          </Avatar>
        ))}
        <AvatarGroupCount>+4</AvatarGroupCount>
      </AvatarGroup>
    </DemoSurface>
  )
}
