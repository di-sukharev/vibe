import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet'
import { DemoSurface } from './demo-surface'

const meta = {
  component: SheetDemo,
  title: 'UI/Overlays/Sheet',
} satisfies Meta<typeof SheetDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
}

function SheetDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <Sheet defaultOpen={defaultOpen}>
        <SheetTrigger render={<Button variant="outline" />}>Open sheet</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Workspace settings</SheetTitle>
            <SheetDescription>Manage preferences without leaving the page.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-2 px-4">
            <Label htmlFor="sheet-name">Name</Label>
            <Input id="sheet-name" defaultValue="Design team" />
          </div>
          <SheetFooter>
            <SheetClose render={<Button />}>Save</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </DemoSurface>
  )
}
