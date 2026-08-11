import { afterEach, expect, test } from 'bun:test'

import { assertTestDatabaseUrl } from './repo-env.mjs'

const envKeys = ['TEST_ALLOW_NON_TEST_DATABASE']
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

test('assertTestDatabaseUrl accepts test databases and rejects development databases', () => {
  expect(() =>
    assertTestDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:55432/web_app_demo_test?schema=public',
    ),
  ).not.toThrow()

  expect(() =>
    assertTestDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public',
    ),
  ).toThrow(/Refusing to run tests against non-test database "web_app_demo"/)
})

test('assertTestDatabaseUrl accepts non-test databases with an intentional override', () => {
  process.env.TEST_ALLOW_NON_TEST_DATABASE = '1'

  expect(() =>
    assertTestDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public',
    ),
  ).not.toThrow()
})
