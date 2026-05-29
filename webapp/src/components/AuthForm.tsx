import { useForm } from '@tanstack/react-form'
import {
  loginRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type RegisterRequest,
} from '@web-app-demo/contracts'
import type { z } from 'zod'
import { useId, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'

type AuthMode = 'login' | 'register'
type FieldName = 'displayName' | 'email' | 'password'
type FormError = { message?: string }
type FieldErrors = Partial<Record<FieldName, FormError[]>>
type AuthDraft = {
  email: string
  password: string
  displayName: string
}

const emptyDraft: AuthDraft = {
  email: '',
  password: '',
  displayName: '',
}

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('register')
  const [draft, setDraft] = useState<AuthDraft>(emptyDraft)

  function updateDraft(nextDraft: Partial<AuthDraft>) {
    setDraft((currentDraft) => ({ ...currentDraft, ...nextDraft }))
  }

  return (
    <Card aria-label="Authentication">
      <CardHeader>
        <CardTitle>Account access</CardTitle>
        <CardDescription>
          Create an account or continue with an existing session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={mode}
          onValueChange={(nextMode) => {
            if (nextMode === 'login' || nextMode === 'register') {
              setMode(nextMode)
            }
          }}
        >
          <TabsList layout="equal">
            <TabsTrigger value="register">Register</TabsTrigger>
            <TabsTrigger value="login">Login</TabsTrigger>
          </TabsList>

          <TabsContent
            value="register"
            forceMount
            hidden={mode !== 'register'}
            spacing="comfortable"
          >
            {mode === 'register' && <RegisterForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
          <TabsContent
            value="login"
            forceMount
            hidden={mode !== 'login'}
            spacing="comfortable"
          >
            {mode === 'login' && <LoginForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function RegisterForm({
  draft,
  onDraftChange,
}: {
  draft: AuthDraft
  onDraftChange: (draft: Partial<AuthDraft>) => void
}) {
  const auth = useAuth()
  const displayNameId = useId()
  const displayNameErrorId = useId()
  const emailId = useId()
  const emailErrorId = useId()
  const passwordId = useId()
  const passwordErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: draft,
    onSubmit: async ({ value }) => {
      setFormError(null)

      const result = registerRequestSchema.safeParse(value)
      if (!result.success) {
        setFieldErrors(toFieldErrors(result.error.issues))
        return
      }

      setFieldErrors({})

      try {
        await auth.register(result.data as RegisterRequest)
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setFormError(caughtError.message)
          return
        }
        setFormError('Unexpected auth error')
      }
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup density="compact">
        <form.Field
          name="displayName"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.displayName)}>
              <FieldLabel htmlFor={displayNameId}>Name</FieldLabel>
              <Input
                id={displayNameId}
                name={field.name}
                value={field.state.value ?? ''}
                autoComplete="name"
                aria-invalid={hasErrors(fieldErrors.displayName)}
                aria-describedby={errorId(fieldErrors.displayName, displayNameErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ displayName: value })
                  clearFieldError('displayName', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={displayNameErrorId} errors={fieldErrors.displayName} />
            </Field>
          )}
        />

        <form.Field
          name="email"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.email)}>
              <FieldLabel htmlFor={emailId}>Email</FieldLabel>
              <Input
                id={emailId}
                name={field.name}
                value={field.state.value}
                type="text"
                inputMode="email"
                autoComplete="email"
                aria-invalid={hasErrors(fieldErrors.email)}
                aria-describedby={errorId(fieldErrors.email, emailErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ email: value })
                  clearFieldError('email', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={emailErrorId} errors={fieldErrors.email} />
            </Field>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.password)}>
              <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
              <Input
                id={passwordId}
                name={field.name}
                value={field.state.value}
                type="password"
                autoComplete="new-password"
                aria-invalid={hasErrors(fieldErrors.password)}
                aria-describedby={errorId(fieldErrors.password, passwordErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ password: value })
                  clearFieldError('password', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={passwordErrorId} errors={fieldErrors.password} />
            </Field>
          )}
        />

        <FormAlert message={formError} />

        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <Button type="submit" size="lg" fullWidth disabled={isSubmitting}>
              {isSubmitting ? 'Working...' : 'Create account'}
            </Button>
          )}
        />
      </FieldGroup>
    </form>
  )
}

function LoginForm({
  draft,
  onDraftChange,
}: {
  draft: AuthDraft
  onDraftChange: (draft: Partial<AuthDraft>) => void
}) {
  const auth = useAuth()
  const emailId = useId()
  const emailErrorId = useId()
  const passwordId = useId()
  const passwordErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: {
      email: draft.email,
      password: draft.password,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)

      const result = loginRequestSchema.safeParse(value)
      if (!result.success) {
        setFieldErrors(toFieldErrors(result.error.issues))
        return
      }

      setFieldErrors({})

      try {
        await auth.login(result.data as LoginRequest)
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setFormError(caughtError.message)
          return
        }
        setFormError('Unexpected auth error')
      }
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup density="compact">
        <form.Field
          name="email"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.email)}>
              <FieldLabel htmlFor={emailId}>Email</FieldLabel>
              <Input
                id={emailId}
                name={field.name}
                value={field.state.value}
                type="text"
                inputMode="email"
                autoComplete="email"
                aria-invalid={hasErrors(fieldErrors.email)}
                aria-describedby={errorId(fieldErrors.email, emailErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ email: value })
                  clearFieldError('email', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={emailErrorId} errors={fieldErrors.email} />
            </Field>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.password)}>
              <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
              <Input
                id={passwordId}
                name={field.name}
                value={field.state.value}
                type="password"
                autoComplete="current-password"
                aria-invalid={hasErrors(fieldErrors.password)}
                aria-describedby={errorId(fieldErrors.password, passwordErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ password: value })
                  clearFieldError('password', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={passwordErrorId} errors={fieldErrors.password} />
            </Field>
          )}
        />

        <FormAlert message={formError} />

        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <Button type="submit" size="lg" fullWidth disabled={isSubmitting}>
              {isSubmitting ? 'Working...' : 'Login'}
            </Button>
          )}
        />
      </FieldGroup>
    </form>
  )
}

function FormAlert({ message }: { message: string | null }) {
  if (!message) return null

  return (
    <Alert variant="destructive">
      <AlertTitle>Authentication failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function toFieldErrors(issues: z.ZodIssue[]): FieldErrors {
  return issues.reduce<FieldErrors>((errors, issue) => {
    const field = issue.path[0]
    if (!isFieldName(field)) return errors

    errors[field] = [...(errors[field] ?? []), { message: issue.message }]
    return errors
  }, {})
}

function clearFieldError(
  field: FieldName,
  setFieldErrors: (updater: (errors: FieldErrors) => FieldErrors) => void,
) {
  setFieldErrors((currentErrors) => {
    if (!currentErrors[field]?.length) return currentErrors
    const nextErrors = { ...currentErrors }
    delete nextErrors[field]
    return nextErrors
  })
}

function hasErrors(errors: FormError[] | undefined) {
  return Boolean(errors?.length)
}

function errorId(errors: FormError[] | undefined, id: string) {
  return hasErrors(errors) ? id : undefined
}

function isFieldName(field: unknown): field is FieldName {
  return field === 'displayName' || field === 'email' || field === 'password'
}
