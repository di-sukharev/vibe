import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
  NavigationMenuTrigger,
  NavigationMenuContent,
} from '@/components/ui/navigation-menu'
import { DemoSurface } from './demo-surface'

const meta = {
  component: NavigationMenuDemo,
  title: 'UI/Navigation/Navigation Menu',
} satisfies Meta<typeof NavigationMenuDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function NavigationMenuDemo() {
  return (
    <DemoSurface>
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink href="#" className={navigationMenuTriggerStyle()}>
              Overview
            </NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
            <NavigationMenuContent>
              <div className="grid w-72 gap-2 p-3">
                <NavigationMenuLink href="#" className="rounded-md p-3 hover:bg-accent">
                  Documentation
                </NavigationMenuLink>
                <NavigationMenuLink href="#" className="rounded-md p-3 hover:bg-accent">
                  Examples
                </NavigationMenuLink>
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </DemoSurface>
  )
}
