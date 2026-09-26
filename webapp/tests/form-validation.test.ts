import { expect, test } from 'bun:test'
import { passwordResetConfirmRequestSchema, registerRequestSchema } from '@web-app-demo/contracts'
import { z } from 'zod'

import {
  passwordConfirmationErrors,
  toValidationErrors,
} from '../src/features/auth/components/form-validation'

test('issues on rendered fields become field errors and leave the form-level slot empty', () => {
  const contract = registerRequestSchema.safeParse({
    email: 'not-an-email',
    password: 'short',
    displayName: 'x',
  })
  const confirmation = z
    .object({ confirmPassword: z.string().min(1, 'Confirm your password') })
    .safeParse({ confirmPassword: '' })
  if (contract.success || confirmation.success) throw new Error('fixtures must fail validation')

  const validation = toValidationErrors([...contract.error.issues, ...confirmation.error.issues])

  expect(validation.fieldErrors.email).toEqual([{ message: issueMessage(contract, 'email') }])
  expect(validation.fieldErrors.password).toEqual([{ message: issueMessage(contract, 'password') }])
  expect(validation.fieldErrors.displayName).toEqual([
    { message: issueMessage(contract, 'displayName') },
  ])
  expect(validation.fieldErrors.confirmPassword).toEqual([
    { message: issueMessage(confirmation, 'confirmPassword') },
  ])
  expect(validation.formError).toBeNull()
})

test('an issue on a field the form does not render is reported at form level, not dropped', () => {
  const result = passwordResetConfirmRequestSchema.safeParse({ token: 'short', password: 'short' })
  if (result.success) throw new Error('fixture must fail validation')

  const validation = toValidationErrors(result.error.issues)

  expect(validation.fieldErrors).toEqual({
    password: [{ message: issueMessage(result, 'password') }],
  })
  expect(validation.formError).toBe(`token: ${issueMessage(result, 'token')}`)
})

test('root-level and unknown-field issues are joined at form level in issue order', () => {
  const unknownField = z.object({ extra: z.string() }).safeParse({})
  const rootLevel = z
    .object({ email: z.string() })
    .refine(() => false, { message: 'This form cannot be submitted as a whole' })
    .safeParse({ email: 'user@example.com' })
  if (unknownField.success || rootLevel.success) throw new Error('fixtures must fail validation')

  const validation = toValidationErrors([...unknownField.error.issues, ...rootLevel.error.issues])

  expect(validation.fieldErrors).toEqual({})
  expect(validation.formError).toBe(
    `extra: ${issueMessage(unknownField, 'extra')}; This form cannot be submitted as a whole`,
  )
})

test('a password confirmation must match the password', () => {
  expect(passwordConfirmationErrors('correct horse', 'correct horse')).toBeUndefined()
  expect(passwordConfirmationErrors('correct horse', 'correct horsE')).toHaveLength(1)
})

function issueMessage(result: z.ZodSafeParseError<unknown>, field: string) {
  const issue = result.error.issues.find((candidate) => candidate.path[0] === field)
  if (!issue) throw new Error(`fixture has no issue on ${field}`)
  return issue.message
}
