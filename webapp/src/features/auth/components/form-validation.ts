import type { z } from 'zod'

import type { FieldErrors, FieldName, FormError, ValidationErrors } from './form-model'

/**
 * Attaches each issue to the field that renders it and reports every other issue at form level.
 * A root-level refinement, or a field the contract gained before the form did, has no field to
 * land on; dropping it would leave the form looking valid while it silently refuses to submit.
 */
export function toValidationErrors(issues: z.ZodIssue[]): ValidationErrors {
  const fieldErrors: FieldErrors = {}
  const formMessages: string[] = []

  for (const issue of issues) {
    const field = issue.path[0]
    if (isFieldName(field)) {
      fieldErrors[field] = [...(fieldErrors[field] ?? []), { message: issue.message }]
    } else {
      formMessages.push(describeIssue(issue))
    }
  }

  return { fieldErrors, formError: formMessages.length ? formMessages.join('; ') : null }
}

export function passwordConfirmationErrors(
  password: string,
  confirmation: string,
): FormError[] | undefined {
  return password === confirmation ? undefined : [{ message: 'Passwords do not match' }]
}

export function clearFieldError(
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

export function hasErrors(errors: FormError[] | undefined) {
  return Boolean(errors?.length)
}

export function errorId(errors: FormError[] | undefined, id: string) {
  return hasErrors(errors) ? id : undefined
}

function describeIssue(issue: z.ZodIssue) {
  if (issue.path.length === 0) return issue.message
  return `${issue.path.map(String).join('.')}: ${issue.message}`
}

function isFieldName(field: unknown): field is FieldName {
  return (
    field === 'confirmPassword' ||
    field === 'displayName' ||
    field === 'email' ||
    field === 'password'
  )
}
