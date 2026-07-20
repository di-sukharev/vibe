import type { AdminUserSummary, UserRole } from '@web-app-demo/contracts'

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

export function RoleChangeDialog({
  error,
  isPending,
  onCancel,
  onConfirm,
  pendingChange,
}: {
  error: Error | null
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
  pendingChange: {
    role: UserRole
    user: AdminUserSummary
  } | null
}) {
  return (
    <AlertDialog
      open={pendingChange !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change user role?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingChange
              ? `${pendingChange.user.email} will become ${pendingChange.role}. Their active sessions will be revoked.`
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Role was not changed</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button disabled={isPending} onClick={onConfirm}>
            {isPending ? 'Changing…' : 'Change role'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
