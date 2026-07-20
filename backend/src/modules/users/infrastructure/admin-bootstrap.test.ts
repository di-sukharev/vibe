import { describe, expect, test } from 'bun:test'

import { parseAdminSeedConfig } from './admin-bootstrap'

describe('admin bootstrap configuration', () => {
  test('uses a locked local admin by default', () => {
    expect(parseAdminSeedConfig({}, { requirePassword: false })).toEqual({
      email: 'admin@example.com',
      password: null,
    })
  })

  test('requires a strong explicit credential for production bootstrap', () => {
    expect(() => parseAdminSeedConfig({}, { requirePassword: true })).toThrow(
      'ADMIN_SEED_EMAIL',
    )
    expect(() =>
      parseAdminSeedConfig(
        {
          ADMIN_SEED_EMAIL: 'admin@example.com',
          ADMIN_SEED_PASSWORD: 'password123',
        },
        { requirePassword: true },
      ),
    ).toThrow('at least 12 characters')
    expect(() =>
      parseAdminSeedConfig(
        {
          ADMIN_SEED_EMAIL: 'admin@example.com',
          ADMIN_SEED_PASSWORD: 'change-me-admin-password',
        },
        { requirePassword: true },
      ),
    ).toThrow('placeholder')
    for (const password of ['            ', 'aaaaaaaaaaaa', 'adminadminadmin']) {
      expect(() =>
        parseAdminSeedConfig(
          {
            ADMIN_SEED_EMAIL: 'admin@example.com',
            ADMIN_SEED_PASSWORD: password,
          },
          { requirePassword: true },
        ),
      ).toThrow()
    }

    expect(
      parseAdminSeedConfig(
        {
          ADMIN_SEED_EMAIL: ' ADMIN@Example.COM ',
          ADMIN_SEED_PASSWORD: 'a-strong-initial-password',
        },
        { requirePassword: true },
      ),
    ).toEqual({
      email: 'admin@example.com',
      password: 'a-strong-initial-password',
    })
  })

  test('rejects partial optional local credentials', () => {
    expect(() =>
      parseAdminSeedConfig(
        { ADMIN_SEED_EMAIL: 'admin@example.com', ADMIN_SEED_PASSWORD: '' },
        { requirePassword: true },
      ),
    ).toThrow()
    expect(() =>
      parseAdminSeedConfig(
        { ADMIN_SEED_EMAIL: 'not-an-email', ADMIN_SEED_PASSWORD: 'a-strong-initial-password' },
        { requirePassword: false },
      ),
    ).toThrow()
  })
})
