import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupInput,
  InputGroupButton,
} from '@/components/ui/input-group'
import { DemoSurface } from './demo-surface'

const meta = {
  component: InputGroupDemo,
  title: 'UI/Inputs/Input Group',
} satisfies Meta<typeof InputGroupDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function InputGroupDemo() {
  return (
    <DemoSurface>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput aria-label="Project domain" placeholder="project.example" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="sm">Copy</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </DemoSurface>
  )
}
