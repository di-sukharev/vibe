import type { Meta, StoryObj } from '@storybook/react-vite'

import { useState } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { DemoSurface } from './demo-surface'

const meta = {
  component: CalendarDemo,
  title: 'UI/Data Display/Calendar',
} satisfies Meta<typeof CalendarDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function CalendarDemo() {
  const [selected, setSelected] = useState<Date | undefined>(new Date(2026, 7, 26))
  return (
    <DemoSurface>
      <Calendar mode="single" onSelect={setSelected} selected={selected} />
    </DemoSurface>
  )
}
