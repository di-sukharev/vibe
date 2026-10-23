import type { Meta, StoryObj } from '@storybook/react-vite'

import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group'
import { Button } from '@/components/ui/button'
import { DemoSurface } from './demo-surface'

const meta = {
  component: ButtonGroupDemo,
  title: 'UI/Inputs/Button Group',
} satisfies Meta<typeof ButtonGroupDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ButtonGroupDemo() {
  return (
    <DemoSurface>
      <ButtonGroup>
        <Button variant="outline">Previous</Button>
        <ButtonGroupText>2 of 8</ButtonGroupText>
        <Button variant="outline">Next</Button>
      </ButtonGroup>
    </DemoSurface>
  )
}
