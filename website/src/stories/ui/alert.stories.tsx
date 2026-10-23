import type { Meta, StoryObj } from '@storybook/react-vite'

import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { DemoSurface } from './demo-surface'

const meta = {
  component: AlertDemo,
  title: 'UI/Feedback/Alert',
} satisfies Meta<typeof AlertDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function AlertDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-4">
        <Alert>
          <AlertTitle>Changes saved</AlertTitle>
          <AlertDescription>Your workspace is up to date.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>Check the connection and try again.</AlertDescription>
        </Alert>
      </div>
    </DemoSurface>
  )
}
