import type { Meta, StoryObj } from '@storybook/react-vite'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { DemoSurface } from './demo-surface'

const meta = {
  component: CardDemo,
  title: 'UI/Data Display/Card',
} satisfies Meta<typeof CardDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function CardDemo() {
  return (
    <DemoSurface>
      <Card>
        <CardHeader>
          <CardTitle>Component card</CardTitle>
          <CardDescription>A reusable surface with consistent spacing.</CardDescription>
          <CardAction>
            <Badge variant="secondary">New</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm">Content remains readable at every viewport.</p>
        </CardContent>
        <CardFooter className="border-t">
          <Button size="sm">Continue</Button>
        </CardFooter>
      </Card>
    </DemoSurface>
  )
}
