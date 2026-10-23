import type { Meta, StoryObj } from '@storybook/react-vite'

import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { DemoSurface } from './demo-surface'

const chartData = [
  { month: 'Jan', total: 18 },
  { month: 'Feb', total: 31 },
  { month: 'Mar', total: 24 },
  { month: 'Apr', total: 42 },
]

const meta = {
  component: ChartDemo,
  title: 'UI/Data Display/Chart',
} satisfies Meta<typeof ChartDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function ChartDemo() {
  return (
    <DemoSurface>
      <ChartContainer
        className="h-64 w-full"
        config={{ total: { color: 'var(--primary)', label: 'Total' } }}
      >
        <BarChart data={chartData} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="total" fill="var(--color-total)" radius={6} />
        </BarChart>
      </ChartContainer>
    </DemoSurface>
  )
}
