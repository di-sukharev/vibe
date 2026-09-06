import { afterEach, beforeEach, expect, test } from 'bun:test'

import { assertE2eDatabaseUrl } from '../e2e/env'

const envKeys = ['E2E_ALLOW_NON_TEST_DATABASE', 'TEST_ALLOW_NON_TEST_DATABASE'] as const
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

beforeEach(() => {
  for (const key of envKeys) delete process.env[key]
})

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

const testDatabaseUrl =
  'postgresql://superuser:superpassword@localhost:54330/web_app_demo_test?schema=public'
const developmentDatabaseUrl =
  'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public'

test('the E2E run accepts a *_test database and refuses a development database', () => {
  expect(() => assertE2eDatabaseUrl(testDatabaseUrl)).not.toThrow()
  expect(() => assertE2eDatabaseUrl(developmentDatabaseUrl)).toThrow(
    /non-test database "web_app_demo".*E2E_ALLOW_NON_TEST_DATABASE=1/,
  )
})

test('only E2E_ALLOW_NON_TEST_DATABASE=1 unlocks a non-test database; the backend runner flag does not', () => {
  process.env.TEST_ALLOW_NON_TEST_DATABASE = '1'
  expect(() => assertE2eDatabaseUrl(developmentDatabaseUrl)).toThrow()

  process.env.E2E_ALLOW_NON_TEST_DATABASE = '1'
  expect(() => assertE2eDatabaseUrl(developmentDatabaseUrl)).not.toThrow()
})
