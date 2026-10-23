import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'
import { DemoSurface } from './demo-surface'

const meta = {
  component: CommandDemo,
  title: 'UI/Navigation/Command',
} satisfies Meta<typeof CommandDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function CommandDemo() {
  return (
    <DemoSurface>
      <Command className="rounded-lg border shadow-sm">
        <CommandInput placeholder="Search commands" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Workspace">
            <CommandItem>
              Open profile<CommandShortcut>⌘P</CommandShortcut>
            </CommandItem>
            <CommandItem>
              Open settings<CommandShortcut>⌘S</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </DemoSurface>
  )
}
