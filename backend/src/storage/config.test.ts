import { describe, expect, test } from 'bun:test'

import { loadEnv } from '../env'
import { deriveLocalSigningKey, privateStorageConfigFromEnv } from './config'

const base = {
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
}

describe('privateStorageConfigFromEnv', () => {
  test('produces a filesystem configuration by default, rooted next to the backend', () => {
    const config = privateStorageConfigFromEnv(loadEnv(base))

    expect(config.driver).toBe('filesystem')
    if (config.driver !== 'filesystem') throw new Error('unreachable')
    expect(config.root.startsWith('/')).toBe(true)
    expect(config.root.endsWith('/.storage')).toBe(true)
    expect(config.publicBaseUrl).toBe('http://127.0.0.1:3000')
    expect(config.uploadMaxBytes).toBe(5 * 1024 * 1024)
  })

  test('follows PORT so the signed local URLs point back at this backend', () => {
    const config = privateStorageConfigFromEnv(loadEnv({ ...base, PORT: '4010' }))

    expect(config.driver === 'filesystem' && config.publicBaseUrl).toBe('http://127.0.0.1:4010')
  })

  test('honours an explicit public URL and strips its trailing slash', () => {
    const config = privateStorageConfigFromEnv(
      loadEnv({ ...base, PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:9999/' }),
    )

    expect(config.driver === 'filesystem' && config.publicBaseUrl).toBe('http://localhost:9999')
  })

  test('keeps an absolute local root untouched', () => {
    const config = privateStorageConfigFromEnv(
      loadEnv({ ...base, PRIVATE_STORAGE_LOCAL_ROOT: '/var/tmp/uploads' }),
    )

    expect(config.driver === 'filesystem' && config.root).toBe('/var/tmp/uploads')
  })

  test('produces an S3 configuration with path-style addressing for a local endpoint', () => {
    const config = privateStorageConfigFromEnv(
      loadEnv({
        ...base,
        PRIVATE_STORAGE_DRIVER: 's3',
        PRIVATE_STORAGE_REGION: 'us-east-1',
        PRIVATE_STORAGE_BUCKET: 'local-private-storage',
        PRIVATE_STORAGE_ENDPOINT: 'http://127.0.0.1:24331',
        PRIVATE_STORAGE_ACCESS_KEY_ID: 'local-key',
        PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'local-secret',
        PRIVATE_STORAGE_FORCE_PATH_STYLE: 'true',
      }),
    )

    expect(config.driver).toBe('s3')
    if (config.driver !== 's3') throw new Error('unreachable')
    expect(config.bucket).toBe('local-private-storage')
    expect(config.endpoint).toBe('http://127.0.0.1:24331')
    expect(config.region).toBe('us-east-1')
    expect(config.forcePathStyle).toBe(true)
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
