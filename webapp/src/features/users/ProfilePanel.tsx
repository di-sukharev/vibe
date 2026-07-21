import type { UserDto } from '@web-app-demo/contracts'
import { useId, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Typography } from '@/components/typography'
import { useUpdateProfileMutation } from './queries'

export function ProfilePanel({ user }: { user: UserDto }) {
  const displayNameErrorId = useId()
  const [displayName, setDisplayName] = useState(user.displayName ?? '')
  const mutation = useUpdateProfileMutation()
  const displayNameInvalid = displayName.trim().length === 1

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = displayName.trim()
    mutation.mutate(normalized === '' ? null : normalized, {
      onSuccess: (response) => setDisplayName(response.user.displayName ?? ''),
    })
  }

  return (
    <Card>
      <CardHeader>
        <Typography as="h2" variant="h6">
          Profile details
        </Typography>
        <CardDescription>
          Update the name shown throughout your workspace. Your email is managed separately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" noValidate onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={displayNameInvalid}>
              <FieldLabel htmlFor="profile-display-name">Display name</FieldLabel>
              <Input
                aria-describedby={displayNameInvalid ? displayNameErrorId : undefined}
                aria-invalid={displayNameInvalid}
                autoComplete="name"
                disabled={mutation.isPending}
                id="profile-display-name"
                maxLength={80}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  mutation.reset()
                }}
                placeholder="Your name"
                value={displayName}
              />
              <FieldDescription>Leave empty to use your email instead.</FieldDescription>
              {displayNameInvalid && (
                <FieldError id={displayNameErrorId}>
                  Display name must be at least 2 characters.
                </FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input
                aria-readonly="true"
                id="profile-email"
                readOnly
                value={user.email}
              />
              <FieldDescription>Email changes are not enabled in this template.</FieldDescription>
            </Field>
          </FieldGroup>

          {mutation.isError && (
            <Alert variant="destructive">
              <AlertTitle>Profile was not saved</AlertTitle>
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          {mutation.isSuccess && (
            <Alert>
              <AlertTitle>Profile saved</AlertTitle>
              <AlertDescription>Your display name is up to date.</AlertDescription>
            </Alert>
          )}

          <div>
            <Button
              disabled={mutation.isPending || displayNameInvalid}
              type="submit"
            >
              {mutation.isPending ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
