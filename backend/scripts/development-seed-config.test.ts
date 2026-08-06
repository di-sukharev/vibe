import { describe, expect, test } from 'bun:test'

import { parseDevelopmentSeedConfig } from './development-seed-config'

const validSource = {
  DATABASE_URL: 'postgresql://app:password@localhost:54329/web_app_demo?schema=public',
  DEV_SEED_ADMIN_EMAIL: 'admin@example.com',
  DEV_SEED_ADMIN_PASSWORD: 'local-admin-password',
  DEV_SEED_USER_EMAIL: 'user@example.com',
  DEV_SEED_USER_PASSWORD: 'local-user-password',
  NODE_ENV: 'development',
}

describe('development seed configuration', () => {
  test('loads distinct login-ready accounts for a loopback development database', () => {
    expect(
      parseDevelopmentSeedConfig({
        ...validSource,
        DEV_SEED_ADMIN_EMAIL: ' ADMIN@Example.COM ',
      }),
    ).toEqual({
      accounts: {
        admin: {
          email: 'admin@example.com',
          password: 'local-admin-password',
        },
        user: {
          email: 'user@example.com',
          password: 'local-user-password',
        },
      },
      databaseUrl: validSource.DATABASE_URL,
    })
  })

  test('rejects production, non-loopback databases, partial credentials, and role collisions', () => {
    expect(() =>
      parseDevelopmentSeedConfig({ ...validSource, NODE_ENV: 'production' }),
    ).toThrow('disabled in production')
    expect(() =>
      parseDevelopmentSeedConfig({
        ...validSource,
        DATABASE_URL: 'postgresql://app:password@database.example.com:5432/app',
      }),
    ).toThrow('loopback PostgreSQL')
    expect(() =>
      parseDevelopmentSeedConfig({
        ...validSource,
        DATABASE_URL: `${validSource.DATABASE_URL}&host=database.example.com`,
      }),
    ).toThrow('loopback PostgreSQL')
    expect(() =>
      parseDevelopmentSeedConfig({ ...validSource, DEV_SEED_USER_PASSWORD: '' }),
    ).toThrow('DEV_SEED_USER_PASSWORD')
    expect(() =>
      parseDevelopmentSeedConfig({
        ...validSource,
        DEV_SEED_USER_EMAIL: validSource.DEV_SEED_ADMIN_EMAIL,
      }),
    ).toThrow('must be different')
  })
})
