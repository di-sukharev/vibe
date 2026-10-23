import type { Meta, StoryObj } from '@storybook/react-vite'

import { Card, CardContent } from '@/components/ui/card'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '@/components/ui/carousel'
import { DemoSurface } from './demo-surface'

const meta = {
  component: CarouselDemo,
  title: 'UI/Data Display/Carousel',
} satisfies Meta<typeof CarouselDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function CarouselDemo() {
  return (
    <DemoSurface>
      <Carousel className="mx-auto w-[calc(100%-6rem)]" opts={{ loop: true }}>
        <CarouselContent>
          {[1, 2, 3].map((item) => (
            <CarouselItem key={item}>
              <Card>
                <CardContent className="grid aspect-video place-items-center text-3xl font-semibold">
                  {item}
                </CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </DemoSurface>
  )
}
