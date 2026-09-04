import { expect, test } from 'bun:test'

import { normalizeBaseUrl } from '../src/platform/api/http-client'

test('normalizeBaseUrl strips exactly one trailing slash', () => {
  expect(normalizeBaseUrl('https://api.example.com/')).toBe('https://api.example.com')
})

test('normalizeBaseUrl leaves a URL without a trailing slash untouched', () => {
  expect(normalizeBaseUrl('https://api.example.com')).toBe('https://api.example.com')
})

test('normalizeBaseUrl only strips the trailing slash, not a path one', () => {
  expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
})
