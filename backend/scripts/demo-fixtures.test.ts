import { describe, expect, test } from 'bun:test'

import { demoFixtureUsers } from './demo-fixtures'

describe('demo fixture users', () => {
  test('have unique emails, so no upsert merges two fixtures into one row', () => {
    const emails = demoFixtureUsers.map((user) => user.email)
    expect(new Set(emails).size).toBe(emails.length)
  })

  test('live under the fixtures domain, apart from the addresses E2E specs mint', () => {
    expect(demoFixtureUsers.every((user) => user.email.endsWith('@fixtures.example.com'))).toBe(true)
  })

  test('have unique day offsets, so the newest-first order is stable', () => {
    const offsets = demoFixtureUsers.map((user) => user.dayOffset)
    expect(new Set(offsets).size).toBe(offsets.length)
  })
})
