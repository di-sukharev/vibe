import { expect, test } from 'bun:test'

import { passwordConfirmationErrors } from '../src/features/auth/components/form-validation'

test('password confirmation reports only mismatched values', () => {
  expect(passwordConfirmationErrors('new-password-123', 'new-password-123')).toBeUndefined()
  expect(passwordConfirmationErrors('new-password-123', 'different-password-123')).toEqual([
    { message: 'Passwords do not match' },
  ])
})
