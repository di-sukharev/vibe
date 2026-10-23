import type { Meta, StoryObj } from '@storybook/react-vite'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableCaption,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { DemoSurface } from './demo-surface'

const meta = {
  component: TableDemo,
  title: 'UI/Data Display/Table',
} satisfies Meta<typeof TableDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function TableDemo() {
  return (
    <DemoSurface>
      <Table>
        <TableCaption>Recent projects</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Members</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[
            ['Website', 'Active', '6'],
            ['Mobile app', 'Draft', '3'],
            ['Research', 'Paused', '2'],
          ].map((row) => (
            <TableRow key={row[0]}>
              <TableCell className="font-medium">{row[0]}</TableCell>
              <TableCell>
                <Badge variant="outline">{row[1]}</Badge>
              </TableCell>
              <TableCell className="text-right">{row[2]}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DemoSurface>
  )
}
