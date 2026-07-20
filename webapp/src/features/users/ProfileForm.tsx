import type { UserDto } from '@web-app-demo/contracts'
import { useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useUpdateProfileMutation } from './queries'

export function ProfileForm({ user }: { user: UserDto }) {
  const [displayName, setDisplayName] = useState(user.displayName ?? '')
  const mutation = useUpdateProfileMutation()

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
        <CardTitle>Profile details</CardTitle>
        <CardDescription>
          Update the name shown throughout your workspace. Your email is managed separately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="profile-display-name">Display name</FieldLabel>
              <Input
                autoComplete="name"
                id="profile-display-name"
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Your name"
                value={displayName}
              />
              <FieldDescription>Leave empty to use your email instead.</FieldDescription>
              {displayName.trim().length === 1 && (
                <FieldError>Display name must be at least 2 characters.</FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input disabled id="profile-email" value={user.email} />
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
              disabled={mutation.isPending || displayName.trim().length === 1}
              type="submit"
            >
              {mutation.isPending ? 'Saving...' : 'Save profile'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
