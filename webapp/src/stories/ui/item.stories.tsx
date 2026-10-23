import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/components/ui/button'
import {
  ItemGroup,
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemSeparator,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { DemoSurface } from './demo-surface'

const meta = {
  component: ItemDemo,
  title: 'UI/Data Display/Item',
} satisfies Meta<typeof ItemDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ItemDemo() {
  return (
    <DemoSurface>
      <ItemGroup>
        <Item variant="outline">
          <ItemMedia variant="icon">A</ItemMedia>
          <ItemContent>
            <ItemTitle>Account settings</ItemTitle>
            <ItemDescription>Profile, password, and security.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="sm" variant="outline">
              Open
            </Button>
          </ItemActions>
        </Item>
        <ItemSeparator />
        <Item>
          <ItemContent>
            <ItemTitle>Notifications</ItemTitle>
            <ItemDescription>Choose which updates you receive.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch aria-label="Notifications" defaultChecked />
          </ItemActions>
        </Item>
      </ItemGroup>
    </DemoSurface>
  )
}
