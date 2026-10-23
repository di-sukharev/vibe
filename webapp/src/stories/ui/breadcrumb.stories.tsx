import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { DemoSurface } from './demo-surface'

const meta = {
  component: BreadcrumbDemo,
  title: 'UI/Navigation/Breadcrumb',
} satisfies Meta<typeof BreadcrumbDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function BreadcrumbDemo() {
  return (
    <DemoSurface>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#">Workspace</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbEllipsis />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Settings</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </DemoSurface>
  )
}
