import { Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  userRoleSchema,
  type AdminUserSummary,
  type UserDto,
  type UserRole,
} from '@web-app-demo/contracts'
import { useState, type FormEvent } from 'react'

import { DataTableFrame } from '@/components/dashboard'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Typography } from '@/components/typography'
import {
  adminUsersPagination,
  adminUsersViewState,
  roleMutationFeedback,
} from './model'
import {
  useAdminUsersQuery,
  useUpdateAdminUserRoleMutation,
} from './queries'
import { RoleChangeDialog } from './RoleChangeDialog'

type PendingRoleChange = {
  role: UserRole
  user: AdminUserSummary
}

export function UserDirectory({ currentUser }: { currentUser: UserDto }) {
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pendingRole, setPendingRole] = useState<PendingRoleChange | null>(null)
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
  const pagination = usersQuery.data
    ? adminUsersPagination(usersQuery.data)
    : null

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

  const summary = usersQuery.data
    ? `Page ${usersQuery.data.page} of ${pagination?.totalPages ?? 1} · ${usersQuery.data.total} users${
        pagination?.wasBounded
          ? ` · First ${pagination.reachableUsers} matches available`
          : ''
      }`
    : viewState === 'error'
      ? 'Users unavailable'
      : 'Loading users'

  return (
    <>
      <div className="grid gap-4">
        {mutationFeedback === 'success' && roleMutation.isSuccess && (
          <Alert>
            <AlertTitle>Role changed</AlertTitle>
            <AlertDescription>
              {roleMutation.data.user.email} is now {roleMutation.data.user.role}.
              Their previous sessions have been revoked.
            </AlertDescription>
          </Alert>
        )}

        <DataTableFrame
          description="Role changes revoke the affected user’s active sessions."
          nextDisabled={!pagination?.canGoNext}
          onNext={() => setPage((current) => current + 1)}
          onPrevious={() => setPage((current) => Math.max(1, current - 1))}
          previousDisabled={page <= 1}
          summary={summary}
          title="User directory"
          toolbar={
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submitSearch}>
              <InputGroup>
                <InputGroupAddon>
                  <HugeiconsIcon aria-hidden icon={Search01Icon} strokeWidth={2} />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Search users"
                  onChange={(event) => setDraftQuery(event.target.value)}
                  placeholder="Search by email or name"
                  value={draftQuery}
                />
              </InputGroup>
              <Button type="submit">Search</Button>
            </form>
          }
        >
          {viewState === 'loading' && <DirectoryLoading />}
          {viewState === 'error' && usersQuery.isError && (
            <DirectoryError
              error={usersQuery.error}
              onRetry={() => void usersQuery.refetch()}
            />
          )}
          {viewState === 'empty' && <DirectoryEmpty hasQuery={query.length > 0} />}
          {viewState === 'ready' && usersQuery.data && (
            <Table className="block sm:table">
              <TableHeader className="hidden sm:table-header-group">
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="grid gap-3 sm:table-row-group">
                {usersQuery.data.items.map((user) => (
                  <TableRow
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border-0 p-4 ring-1 ring-border sm:table-row sm:rounded-none sm:border-b sm:p-0 sm:ring-0"
                    key={user.id}
                  >
                    <TableCell className="min-w-0 p-0 whitespace-normal sm:p-3 sm:whitespace-nowrap">
                      <div className="grid">
                        <Typography variant="bodySmMedium">
                          {user.displayName ?? user.email}
                        </Typography>
                        <Typography className="break-all" variant="caption" tone="muted">
                          {user.email}
                        </Typography>
                      </div>
                    </TableCell>
                    <TableCell className="p-0 sm:p-3">
                      <Select
                        disabled={roleMutation.isPending}
                        onValueChange={(value) => {
                          const parsedRole = userRoleSchema.safeParse(value)
                          if (parsedRole.success && parsedRole.data !== user.role) {
                            roleMutation.reset()
                            setPendingRole({ role: parsedRole.data, user })
                          }
                        }}
                        value={user.role}
                      >
                        <SelectTrigger
                          aria-label={`Role for ${user.email}`}
                          className="w-28 capitalize"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            disabled={user.id === currentUser.id && user.role === 'admin'}
                            value="user"
                          >
                            User
                          </SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="col-span-2 flex items-center justify-between border-t p-0 pt-3 tabular-nums sm:table-cell sm:border-0 sm:p-3">
                      <Typography className="sm:hidden" variant="caption" tone="muted">
                        Created
                      </Typography>
                      <Typography as="span" variant="bodySm">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DataTableFrame>
      </div>

      <RoleChangeDialog
        error={roleMutation.isError ? roleMutation.error : null}
        isPending={roleMutation.isPending}
        onCancel={() => {
          roleMutation.reset()
          setPendingRole(null)
        }}
        onConfirm={confirmRoleChange}
        pendingChange={pendingRole}
      />
    </>
  )
}

function DirectoryLoading() {
  return (
    <div aria-label="Loading users" className="grid gap-3 py-2" role="status">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  )
}

function DirectoryError({
  error,
  onRetry,
}: {
  error: Error
  onRetry: () => void
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Users are unavailable</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
      <AlertAction>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Try again
        </Button>
      </AlertAction>
    </Alert>
  )
}

function DirectoryEmpty({ hasQuery }: { hasQuery: boolean }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No users found</EmptyTitle>
        <EmptyDescription>
          {hasQuery
            ? 'Try a different name or email.'
            : 'No accounts are available yet.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
