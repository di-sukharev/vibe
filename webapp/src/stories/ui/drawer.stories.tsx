import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import { DemoSurface } from './demo-surface'

const meta = {
  component: DrawerDemo,
  title: 'UI/Overlays/Drawer',
} satisfies Meta<typeof DrawerDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
}

function DrawerDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <Drawer defaultOpen={defaultOpen} showSwipeHandle>
        <DrawerTrigger render={<Button variant="outline" />}>Open drawer</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Quick settings</DrawerTitle>
            <DrawerDescription>Adjust the current workspace.</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <DrawerClose render={<Button />}>Done</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </DemoSurface>
  )
}
