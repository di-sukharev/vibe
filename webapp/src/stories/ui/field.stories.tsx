import type { Meta, StoryObj } from '@storybook/react-vite'

import { FieldGroup, Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { DemoSurface } from './demo-surface'

const meta = {
  component: FieldDemo,
  title: 'UI/Inputs/Field',
} satisfies Meta<typeof FieldDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function FieldDemo() {
  return (
    <DemoSurface>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="story-name">Display name</FieldLabel>
          <Input id="story-name" placeholder="Your name" />
          <FieldDescription>Shown to people in your workspace.</FieldDescription>
        </Field>
        <Field data-invalid>
          <FieldLabel htmlFor="story-code">Invite code</FieldLabel>
          <Input id="story-code" aria-invalid defaultValue="x" />
          <FieldError>Use at least four characters.</FieldError>
        </Field>
      </FieldGroup>
    </DemoSurface>
  )
}
