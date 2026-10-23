import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { DemoSurface } from './demo-surface'

const meta = {
  component: AccordionDemo,
  title: 'UI/Navigation/Accordion',
} satisfies Meta<typeof AccordionDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function AccordionDemo() {
  return (
    <DemoSurface>
      <Accordion defaultValue={['first']}>
        <AccordionItem value="first">
          <AccordionTrigger>What is included?</AccordionTrigger>
          <AccordionContent>All core UI states and responsive behavior.</AccordionContent>
        </AccordionItem>
        <AccordionItem value="second">
          <AccordionTrigger>Can it be customized?</AccordionTrigger>
          <AccordionContent>Yes. Components use local design tokens.</AccordionContent>
        </AccordionItem>
      </Accordion>
    </DemoSurface>
  )
}
