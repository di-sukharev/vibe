import type { Meta, StoryObj } from '@storybook/react-vite'

import { DataTableFrame } from '@/components/dashboard'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const rows = [
  ['Website refresh', 'Active', 'Alex'],
  ['Mobile onboarding', 'Review', 'Taylor'],
  ['Research library', 'Draft', 'Morgan'],
]

const meta = {
  component: DataTableFrame,
  title: 'Components/Data Table Frame',
  args: {
    children: null,
    description: 'A reusable surface for tabular collections.',
    nextDisabled: false,
    onNext: () => undefined,
    onPrevious: () => undefined,
    previousDisabled: true,
    summary: 'Showing 1–3 of 18 projects',
    title: 'Projects',
    toolbar: <Input className="max-w-xs" placeholder="Filter projects" />,
  },
  render: (args) => (
    <DataTableFrame {...args}>
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Owner</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map(([name, status, owner]) => <TableRow key={name}><TableCell>{name}</TableCell><TableCell>{status}</TableCell><TableCell>{owner}</TableCell></TableRow>)}</TableBody>
      </Table>
    </DataTableFrame>
  ),
} satisfies Meta<typeof DataTableFrame>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = {
  args: {
    children: null,
    nextDisabled: true,
    summary: 'No projects found',
    toolbar: undefined,
  },
  render: (args) => <DataTableFrame {...args}><div className="py-8 text-center text-sm text-muted-foreground">No projects match the current filters.</div></DataTableFrame>,
}
