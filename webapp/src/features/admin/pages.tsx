import type { AdminUserSummary, UserDto, UserRole } from '@web-app-demo/contracts'
import { useState, type FormEvent } from 'react'

import { PageContainer, PageHeader } from '@/components/PageLayout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Typography } from '@/components/ui/typography'
import { AppearanceSettings } from '@/features/settings'
import { ProfileForm } from '@/features/users'
import {
  useAdminDashboardQuery,
  useAdminUsersQuery,
  useUpdateAdminUserRoleMutation,
} from './queries'
import { adminUsersViewState, roleMutationFeedback } from './model'

export function AdminDashboard() {
  const query = useAdminDashboardQuery()

  return (
    <PageContainer>
      <PageHeader
        description="A live overview of accounts and administrator coverage."
        title="Dashboard"
      />
      {query.isPending && <Loading label="Loading dashboard..." />}
      {query.isError && <QueryError title="Dashboard is unavailable" error={query.error} />}
      {query.data && (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Total users" value={query.data.totalUsers} />
          <MetricCard label="Administrators" value={query.data.totalAdmins} />
          <MetricCard label="New in 7 days" value={query.data.newUsersLast7Days} />
        </div>
      )}
    </PageContainer>
  )
}

export function AdminUsers({ currentUser }: { currentUser: UserDto }) {
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pendingRole, setPendingRole] = useState<{
    role: UserRole
    user: AdminUserSummary
  } | null>(null)
  const usersQuery = useAdminUsersQuery({
    q: query || undefined,
    page,
    pageSize: 20,
  })
  const roleMutation = useUpdateAdminUserRoleMutation()
  const viewState = adminUsersViewState({
    isError: usersQuery.isError,
    isPending: usersQuery.isPending,
    itemCount: usersQuery.data?.items.length,
  })
  const mutationFeedback = roleMutationFeedback(roleMutation)
  const totalPages = usersQuery.data
    ? Math.max(1, Math.ceil(usersQuery.data.total / usersQuery.data.pageSize))
    : 1

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setQuery(draftQuery.trim())
  }

  const confirmRoleChange = () => {
    if (!pendingRole) return
    roleMutation.mutate(
      { role: pendingRole.role, userId: pendingRole.user.id },
      { onSuccess: () => setPendingRole(null) },
    )
  }

  return (
    <PageContainer>
      <PageHeader
        description="Find accounts and manage access without exposing credential data."
        title="Users"
      />
      <Card>
        <CardHeader>
          <CardTitle>User directory</CardTitle>
          <CardDescription>
            Role changes revoke the affected user&apos;s active sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submitSearch}>
            <Input
              aria-label="Search users"
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder="Search by email or name"
              value={draftQuery}
            />
            <Button type="submit">Search</Button>
          </form>

          {viewState === 'loading' && <Loading label="Loading users..." />}
          {viewState === 'error' && usersQuery.isError && (
            <QueryError title="Users are unavailable" error={usersQuery.error} />
          )}
          {mutationFeedback === 'success' && roleMutation.isSuccess && (
            <Alert>
              <AlertTitle>Role changed</AlertTitle>
              <AlertDescription>
                {roleMutation.data.user.email} is now {roleMutation.data.user.role}.
              </AlertDescription>
            </Alert>
          )}
          {viewState === 'empty' && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No users found</EmptyTitle>
                <EmptyDescription>Try a different name or email.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {viewState === 'ready' && usersQuery.data && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersQuery.data.items.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="grid">
                          <Typography variant="bodySmMedium">
                            {user.displayName ?? user.email}
                          </Typography>
                          <Typography variant="caption" tone="muted">
                            {user.email}
                          </Typography>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          disabled={roleMutation.isPending}
                          onValueChange={(value) => {
                            if (value !== user.role) {
                              roleMutation.reset()
                              setPendingRole({ role: value as UserRole, user })
                            }
                          }}
                          value={user.role}
                        >
                          <SelectTrigger aria-label={`Role for ${user.email}`} className="capitalize">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              disabled={user.id === currentUser.id && user.role === 'admin'}
                              value="user"
                            >
                              User
                            </SelectItem>
                            <SelectItem value="admin">
                              Admin
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between gap-3">
                <Typography variant="bodySm" tone="muted">
                  Page {usersQuery.data.page} of {totalPages} · {usersQuery.data.total} users
                </Typography>
                <div className="flex gap-2">
                  <Button
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    type="button"
                    variant="outline"
                  >
                    Previous
                  </Button>
                  <Button
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => current + 1)}
                    type="button"
                    variant="outline"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingRole !== null}
        onOpenChange={(open) => {
          if (!open && !roleMutation.isPending) setPendingRole(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change user role?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRole
                ? `${pendingRole.user.email} will become ${pendingRole.role}. Their active sessions will be revoked.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {roleMutation.isError && (
            <QueryError title="Role was not changed" error={roleMutation.error} />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={roleMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              disabled={roleMutation.isPending}
              onClick={confirmRoleChange}
            >
              {roleMutation.isPending ? 'Changing...' : 'Change role'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  )
}

export function AdminSettings({ user }: { user: UserDto }) {
  return (
    <PageContainer>
      <PageHeader
        description="Manage your administrator identity and workspace appearance."
        title="Settings"
      />
      <ProfileForm user={user} />
      <AppearanceSettings />
    </PageContainer>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value.toLocaleString()}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-8">
      <Spinner />
      <Typography tone="muted">{label}</Typography>
    </div>
  )
}

function QueryError({ error, title }: { error: Error; title: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  )
}
