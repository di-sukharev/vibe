import { expect, test } from 'bun:test'

import { isDisplayNameTooShort } from '../src/features/users/model'

test('a single visible character is flagged before the surrounding whitespace is trimmed', () => {
  expect(isDisplayNameTooShort('  A  ')).toBe(true)
})

test('two or more characters are not flagged', () => {
  expect(isDisplayNameTooShort('Jo')).toBe(false)
})

test('an empty display name is not flagged, since it clears the name entirely', () => {
  expect(isDisplayNameTooShort('')).toBe(false)
  expect(isDisplayNameTooShort('   ')).toBe(false)
})
