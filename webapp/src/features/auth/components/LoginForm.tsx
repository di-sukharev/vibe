import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import { loginRequestSchema, type LoginRequest } from '@web-app-demo/contracts'
import { useId, useState } from 'react'

import { Typography } from '@/components/typography'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ApiRequestError } from '@/platform/api'
import { useAuth } from '../use-auth'
import { FormAlert } from './form-errors'
import type { FieldErrors } from './form-model'
import { clearFieldError, errorId, hasErrors, toFieldErrors } from './form-validation'
import { PasswordInput } from './PasswordInput'

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const auth = useAuth()
  const emailId = useId()
  const emailErrorId = useId()
  const passwordId = useId()
  const passwordErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email: '', password: '' },
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
        setFormError(
          caughtError instanceof ApiRequestError ? caughtError.message : 'Unexpected auth error',
        )
      }
    },
  })

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <Typography as="h1" variant="h3" balance>
            Login to your account
          </Typography>
          <Typography variant="bodySm" tone="muted" balance>
            Enter your email below to login to your account
          </Typography>
        </div>

        <form.Field
          name="email"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.email)}>
              <FieldLabel htmlFor={emailId}>Email</FieldLabel>
              <Input
                aria-describedby={errorId(fieldErrors.email, emailErrorId)}
                aria-invalid={hasErrors(fieldErrors.email)}
                autoComplete="email"
                className="bg-background"
                id={emailId}
                inputMode="email"
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value)
                  clearFieldError('email', setFieldErrors)
                  setFormError(null)
                }}
                placeholder="m@example.com"
                type="email"
                value={field.state.value}
              />
              <FieldError id={emailErrorId} errors={fieldErrors.email} />
            </Field>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.password)}>
              <div className="flex items-center">
                <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
                <Typography asChild variant="bodySm">
                  <Link className="ml-auto underline-offset-4 hover:underline" to="/forgot-password">
                    Forgot your password?
                  </Link>
                </Typography>
              </div>
              <PasswordInput
                aria-describedby={errorId(fieldErrors.password, passwordErrorId)}
                aria-invalid={hasErrors(fieldErrors.password)}
                autoComplete="current-password"
                className="bg-background"
                id={passwordId}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value)
                  clearFieldError('password', setFieldErrors)
                  setFormError(null)
                }}
                value={field.state.value}
              />
              <FieldError id={passwordErrorId} errors={fieldErrors.password} />
            </Field>
          )}
        />

        <FormAlert message={formError} />

        <Field>
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(isSubmitting) => (
              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Signing in…' : 'Login'}
              </Button>
            )}
          />
        </Field>

        <FieldDescription className="text-center">
          Don&apos;t have an account?{' '}
          <Link search={{ returnTo }} to="/signup">
            Sign up
          </Link>
        </FieldDescription>
      </FieldGroup>
    </form>
  )
}
