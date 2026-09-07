import type { UserDto } from '@web-app-demo/contracts'
import { useId, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Typography } from '@/components/typography'
import { errorId, hasErrors } from '@/features/auth'
import { validateProfileForm } from './profile-form'
import { useUpdateProfileMutation } from './queries'

export function ProfilePanel({ user }: { user: UserDto }) {
  const displayNameErrorId = useId()
  const [displayName, setDisplayName] = useState(user.displayName ?? '')
  const mutation = useUpdateProfileMutation()
  const validation = validateProfileForm(displayName)
  const displayNameErrors = validation.errors?.fieldErrors.displayName
  const displayNameInvalid = hasErrors(displayNameErrors)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validation.request) return
    mutation.mutate(validation.request.displayName, {
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
                aria-describedby={errorId(displayNameErrors, displayNameErrorId)}
                aria-invalid={displayNameInvalid}
                autoComplete="name"
                disabled={mutation.isPending}
                id="profile-display-name"
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  mutation.reset()
                }}
                placeholder="Your name"
                value={displayName}
              />
              <FieldDescription>Leave empty to use your email instead.</FieldDescription>
              <FieldError id={displayNameErrorId} errors={displayNameErrors} />
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

          {validation.errors?.formError && (
            <Alert variant="destructive">
              <AlertTitle>Profile cannot be saved</AlertTitle>
              <AlertDescription>{validation.errors.formError}</AlertDescription>
            </Alert>
          )}
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
              disabled={mutation.isPending || validation.errors !== null}
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
