import type { UserDto } from '@web-app-demo/contracts'
import { useRef, useState, type ChangeEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { FieldDescription } from '@/components/ui/field'
import { Typography } from '@/components/typography'
import { ApiRequestError } from '@/platform/api'
import {
  useAvatarImage,
  useAvatarQuery,
  useDeleteAvatarMutation,
  useUploadAvatarMutation,
} from './queries'
import { AvatarUploadError } from './upload'

const acceptedFileTypes = 'image/jpeg,image/png,image/heic,image/heif'

export function AvatarPanel({ user }: { user: UserDto }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const avatarQuery = useAvatarQuery()
  const upload = useUploadAvatarMutation()
  const remove = useDeleteAvatarMutation()
  const imageUrl = useAvatarImage(avatarQuery.data?.avatar?.downloadUrl)

  const busy = upload.isPending || remove.isPending
  const hasAvatar = Boolean(avatarQuery.data?.avatar)

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Clear the input so picking the same file twice still fires a change event, which is what
    // a retry after a failed upload looks like.
    event.target.value = ''
    if (!file) return

    setNotice(null)
    upload.mutate(file, {
      onSuccess: () => setNotice('Photo updated.'),
    })
  }

  return (
    <Card>
      <CardHeader>
        <Typography as="h2" variant="h6">
          Profile photo
        </Typography>
        <CardDescription>
          Shown next to your name across the workspace. Only you can see the original file.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar data-testid="avatar-preview" size="xl">
            {imageUrl && <AvatarImage alt="" src={imageUrl} />}
            <AvatarFallback data-testid="avatar-fallback">{initials(user)}</AvatarFallback>
          </Avatar>

          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => fileInput.current?.click()}
                type="button"
                variant="outline"
              >
                {upload.isPending ? 'Uploading…' : hasAvatar ? 'Replace photo' : 'Upload photo'}
              </Button>
              {hasAvatar && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setNotice(null)
                    remove.mutate(undefined, { onSuccess: () => setNotice('Photo removed.') })
                  }}
                  type="button"
                  variant="ghost"
                >
                  {remove.isPending ? 'Removing…' : 'Remove'}
                </Button>
              )}
            </div>
            <FieldDescription>JPEG, PNG, or HEIC, up to 5 MB.</FieldDescription>
          </div>

          <input
            accept={acceptedFileTypes}
            aria-label="Profile photo"
            className="sr-only"
            data-testid="avatar-file-input"
            onChange={pick}
            ref={fileInput}
            type="file"
          />
        </div>

        {upload.isError && (
          <Alert data-testid="avatar-error" variant="destructive">
            <AlertTitle>Photo was not saved</AlertTitle>
            <AlertDescription>{uploadErrorMessage(upload.error)}</AlertDescription>
          </Alert>
        )}
        {remove.isError && (
          <Alert data-testid="avatar-remove-error" variant="destructive">
            <AlertTitle>Photo was not removed</AlertTitle>
            <AlertDescription>{remove.error.message}</AlertDescription>
          </Alert>
        )}
        {notice && !upload.isError && !remove.isError && (
          <Alert data-testid="avatar-notice">
            <AlertTitle>{notice}</AlertTitle>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Each backend upload failure names something the person can do next, so they are surfaced
 * rather than collapsed into one generic message.
 */
function uploadErrorMessage(error: unknown) {
  if (error instanceof AvatarUploadError) return error.message

  if (error instanceof ApiRequestError) {
    if (error.code === 'UPLOAD_NOT_COMPLETED') {
      return 'The upload did not finish. Try sending the photo again.'
    }
    if (error.code === 'UPLOAD_EXPIRED') {
      return 'The upload took too long. Pick the photo again to start over.'
    }
    if (error.code === 'UPLOAD_REJECTED') {
      return 'That file is not a supported image. Pick a JPEG, PNG, or HEIC photo.'
    }
  }

  return error instanceof Error ? error.message : 'Something went wrong. Try again.'
}

function initials(user: UserDto) {
  const source = user.displayName?.trim() || user.email

  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
