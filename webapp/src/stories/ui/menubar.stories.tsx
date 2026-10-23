import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarShortcut,
  MenubarSeparator,
  MenubarCheckboxItem,
} from '@/components/ui/menubar'
import { DemoSurface } from './demo-surface'

const meta = {
  component: MenubarDemo,
  title: 'UI/Navigation/Menubar',
} satisfies Meta<typeof MenubarDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function MenubarDemo() {
  return (
    <DemoSurface>
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>
              New project<MenubarShortcut>⌘N</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>Archive</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarCheckboxItem defaultChecked>Sidebar</MenubarCheckboxItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </DemoSurface>
  )
}
