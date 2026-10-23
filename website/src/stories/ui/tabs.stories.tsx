import type { Meta, StoryObj } from '@storybook/react-vite'

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { DemoSurface } from './demo-surface'

const meta = {
  component: TabsDemo,
  title: 'UI/Navigation/Tabs',
} satisfies Meta<typeof TabsDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function TabsDemo() {
  return (
    <DemoSurface>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings" disabled>
            Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent className="rounded-lg border p-4" value="overview">
          Overview content
        </TabsContent>
        <TabsContent className="rounded-lg border p-4" value="activity">
          Activity content
        </TabsContent>
      </Tabs>
    </DemoSurface>
  )
}
