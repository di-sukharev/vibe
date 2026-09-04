import { expect, test } from 'bun:test'
import type { UserDto } from '@web-app-demo/contracts'

import { initials } from '../src/features/avatar/model'

function user(overrides: Partial<UserDto>): UserDto {
  return {
    id: 'user_1',
    email: 'user@example.com',
    displayName: null,
    role: 'user',
    createdAt: '2026-05-11T00:00:00.000Z',
    ...overrides,
  }
}

test('initials takes the first letter of each of the first two display-name words', () => {
  expect(initials(user({ displayName: 'Ольга Смирнова' }))).toBe('ОС')
})

test('initials falls back to the email when there is no display name', () => {
  expect(initials(user({ displayName: null, email: 'jane.doe@example.com' }))).toBe('JD')
})

test('initials falls back to the email when the display name is only whitespace', () => {
  expect(initials(user({ displayName: '   ', email: 'jane.doe@example.com' }))).toBe('JD')
})

test('initials handles a right-to-left name', () => {
  expect(initials(user({ displayName: 'محمد علي' }))).toBe('مع')
})

test('initials uses one letter when there is only one word', () => {
  expect(initials(user({ displayName: 'Zoe' }))).toBe('Z')
})
