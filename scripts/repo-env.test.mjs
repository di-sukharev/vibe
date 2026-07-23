import { afterEach, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  assertTestDatabaseUrl,
  defaultTestDatabaseUrl,
  postgresPortFromDatabaseUrl,
  repositoryRoot,
} from './repo-env.mjs'

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

test('environment files live under their owning apps instead of the repository root', async () => {
  const rootEnvironmentFiles = (await readdir(repositoryRoot))
    .filter((name) => name.startsWith('.env'))
    .sort()

  expect(rootEnvironmentFiles).toEqual([])
})

test('backend env example owns the local Docker Compose ports', async () => {
  const backendEnvExample = await readFile(resolve(repositoryRoot, 'backend/.env.example'), 'utf8')

  expect(backendEnvExample).toMatch(/^POSTGRES_PORT=54329$/m)
  expect(backendEnvExample).toMatch(/^POSTGRES_TEST_PORT=54330$/m)
})

test('defaultTestDatabaseUrl builds the documented postgres test URL', () => {
  expect(defaultTestDatabaseUrl('55432')).toBe(
    'postgresql://superuser:superpassword@localhost:55432/web_app_demo_test?schema=public',
  )
})

test('postgresPortFromDatabaseUrl returns explicit ports and postgres defaults', () => {
  expect(
    postgresPortFromDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:55432/web_app_demo_test?schema=public',
    ),
  ).toBe('55432')
  expect(
    postgresPortFromDatabaseUrl(
      'postgresql://superuser:superpassword@localhost/web_app_demo_test?schema=public',
    ),
  ).toBe('5432')
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
