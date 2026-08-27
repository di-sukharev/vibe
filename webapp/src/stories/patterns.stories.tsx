import type { Meta, StoryObj } from '@storybook/react-vite'

import { DataTableFrame, SectionCards } from '@/components/dashboard'
import { PageHeader } from '@/components/PageLayout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Typography } from '@/components/typography'

const meta = {
  title: 'Patterns/Application',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function PatternSurface({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-6xl gap-6 p-5 md:p-8">{children}</main>
}

export const FormCard: Story = {
  render: () => (
    <PatternSurface>
      <PageHeader description="A focused form composed from fields and card primitives." title="Profile settings" />
      <Card className="max-w-2xl">
        <CardHeader><Typography as="h2" variant="h6">Profile details</Typography><CardDescription>Update the details shown throughout your workspace.</CardDescription></CardHeader>
        <CardContent>
          <FieldGroup>
            <Field><FieldLabel htmlFor="pattern-name">Display name</FieldLabel><Input id="pattern-name" defaultValue="Alex Morgan" /><FieldDescription>Use the name teammates recognize.</FieldDescription></Field>
            <Field><FieldLabel htmlFor="pattern-email">Email</FieldLabel><Input id="pattern-email" readOnly value="alex@example.com" /><FieldDescription>Email changes are managed separately.</FieldDescription></Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end border-t"><Button variant="outline">Cancel</Button><Button>Save changes</Button></CardFooter>
      </Card>
    </PatternSurface>
  ),
}

export const Metrics: Story = {
  render: () => (
    <PatternSurface>
      <PageHeader description="Responsive summary cards for the current workspace." title="Overview" />
      <SectionCards items={[{ label: 'Active projects', value: 12, description: '+3 this month' }, { label: 'Team members', value: 28, description: '4 invited' }, { label: 'Tasks completed', value: '84%', description: 'Last 30 days' }]} />
    </PatternSurface>
  ),
}

export const DataTable: Story = {
  render: () => (
    <PatternSurface>
      <DataTableFrame description="A reusable table frame with toolbar and pagination." nextDisabled={false} onNext={() => undefined} onPrevious={() => undefined} previousDisabled summary="Showing 1–3 of 18 projects" title="Projects" toolbar={<Input className="max-w-xs" placeholder="Filter projects" />}>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Owner</TableHead></TableRow></TableHeader>
          <TableBody>{[['Website refresh', 'Active', 'Alex'], ['Mobile onboarding', 'Review', 'Taylor'], ['Research library', 'Draft', 'Morgan']].map(([name, status, owner]) => <TableRow key={name}><TableCell className="font-medium">{name}</TableCell><TableCell><Badge variant="outline">{status}</Badge></TableCell><TableCell>{owner}</TableCell></TableRow>)}</TableBody>
        </Table>
      </DataTableFrame>
    </PatternSurface>
  ),
}

export const LoadingEmptyError: Story = {
  render: () => (
    <PatternSurface>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card><CardHeader><Typography as="h2" variant="h6">Loading</Typography></CardHeader><CardContent className="grid gap-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></CardContent></Card>
        <Card><CardContent><Empty className="p-4"><EmptyHeader><EmptyMedia variant="icon">∅</EmptyMedia><EmptyTitle>No results</EmptyTitle><EmptyDescription>Try another filter.</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm" variant="outline">Clear filter</Button></EmptyContent></Empty></CardContent></Card>
        <Alert variant="destructive"><AlertTitle>Could not load projects</AlertTitle><AlertDescription>The connection was interrupted. Try again.</AlertDescription></Alert>
      </div>
    </PatternSurface>
  ),
}
