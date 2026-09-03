import { expect, test } from 'bun:test'
import { passwordResetConfirmRequestSchema, registerRequestSchema } from '@web-app-demo/contracts'
import type { z } from 'zod'

import {
  passwordConfirmationErrors,
  toFieldErrors,
  unmappableIssueMessage,
} from '../src/features/auth/components/form-validation'

test('password confirmation reports only mismatched values', () => {
  expect(passwordConfirmationErrors('new-password-123', 'new-password-123')).toBeUndefined()
  expect(passwordConfirmationErrors('new-password-123', 'different-password-123')).toEqual([
    { message: 'Passwords do not match' },
  ])
})

test('toFieldErrors routes each issue to the input that renders it', () => {
  const result = registerRequestSchema.safeParse({
    email: 'not-an-email',
    password: 'short',
    displayName: 'x',
  })
  if (result.success) throw new Error('expected the invalid registration to fail validation')

  const errors = toFieldErrors(result.error.issues)

  expect(Object.keys(errors).sort()).toEqual(['displayName', 'email', 'password'])
  expect(errors.email?.length).toBeGreaterThan(0)
  expect(errors.email?.[0]?.message).toBe(
    result.error.issues.find((issue) => issue.path[0] === 'email')?.message,
  )
})

test('toFieldErrors keeps every issue for a field instead of only the last one', () => {
  const errors = toFieldErrors([
    { path: ['password'], message: 'Too short' },
    { path: ['password'], message: 'Needs a digit' },
  ] as z.ZodIssue[])

  expect(errors.password).toEqual([{ message: 'Too short' }, { message: 'Needs a digit' }])
})

test('an issue with no rendered input is surfaced as a form error instead of vanishing', () => {
  const result = passwordResetConfirmRequestSchema.safeParse({
    token: 'too-short-to-be-a-reset-token',
    password: 'new-password-123',
  })
  if (result.success) throw new Error('expected the short reset token to fail validation')

  expect(toFieldErrors(result.error.issues)).toEqual({})
  expect(unmappableIssueMessage(result.error.issues)).toBe(result.error.issues[0]!.message)
})

test('unmappableIssueMessage stays quiet when every issue has its own input', () => {
  const result = registerRequestSchema.safeParse({
    email: 'not-an-email',
    password: 'short',
    displayName: 'x',
  })
  if (result.success) throw new Error('expected the invalid registration to fail validation')

  expect(unmappableIssueMessage(result.error.issues)).toBeUndefined()
})
