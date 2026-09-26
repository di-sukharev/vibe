import { describe, expect, test } from 'bun:test'

import { loadEnv } from '../env'
import { deriveLocalSigningKey, privateStorageConfigFromEnv } from './config'

const base = {
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
}

describe('privateStorageConfigFromEnv', () => {
  test('honours an explicit public URL and strips its trailing slash', () => {
    const config = privateStorageConfigFromEnv(
      loadEnv({ ...base, PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:9999/' }),
    )

    expect(config.driver === 'filesystem' && config.publicBaseUrl).toBe('http://localhost:9999')
  })
})

describe('deriveLocalSigningKey', () => {
  test('is deterministic per secret and unrelated to the raw secret', () => {
    const key = deriveLocalSigningKey('a-secret-that-is-long-enough-to-use')

    expect(key).toEqual(deriveLocalSigningKey('a-secret-that-is-long-enough-to-use'))
    expect(key.length).toBe(32)
    expect(key.toString('utf8')).not.toContain('a-secret')
  })

  test('changes when the JWT secret rotates, so old upload URLs stop verifying', () => {
    expect(deriveLocalSigningKey('secret-one')).not.toEqual(deriveLocalSigningKey('secret-two'))
  })
})
