import { describe, expect, test } from 'bun:test'

import { apiErrorCodeSchema, apiErrorSchema } from './index'

describe('api error contracts', () => {
  test('accepts every declared error code', () => {
    for (const code of apiErrorCodeSchema.options) {
      expect(
        apiErrorSchema.parse({ error: { code, message: 'Something went wrong' } }).error.code,
      ).toBe(code)
    }
  })

  test('rejects a code outside the declared set', () => {
    expect(() =>
      apiErrorSchema.parse({ error: { code: 'SOMETHING_ELSE', message: 'Nope' } }),
    ).toThrow()
  })

  test('keeps details optional and passes it through untouched when present', () => {
    expect(
      apiErrorSchema.parse({ error: { code: 'NOT_FOUND', message: 'Missing' } }).error.details,
    ).toBeUndefined()
    expect(
      apiErrorSchema.parse({
        error: { code: 'NOT_FOUND', message: 'Missing', details: { resource: 'user' } },
      }).error.details,
    ).toEqual({ resource: 'user' })
  })

  // Locks current behavior rather than asserting it is correct: the schema does not require a
  // non-empty message, so this documents the gap without changing behavior on a guess.
  test('currently accepts an empty error message', () => {
    expect(
      apiErrorSchema.parse({ error: { code: 'BAD_REQUEST', message: '' } }).error.message,
    ).toBe('')
  })
})
