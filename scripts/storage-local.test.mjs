import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  assertLocalPrivateStorageEndpoint,
  composeEnv,
  defaultPostgresTestPort,
  defaultPrivateStorageS3Port,
  localPrivateStorageCorsRule,
  localPrivateStorageEndpoint,
  localPrivateStorageEnv,
  repositoryRoot,
} from './repo-env.mjs'
import { envBlock } from './storage-local.mjs'

describe('local storage ports', () => {
  test('sits in a band no other repository-derived port uses', () => {
    const port = Number(defaultPrivateStorageS3Port)

    expect(port).toBeGreaterThanOrEqual(24000)
    expect(port).toBeLessThan(28000)

    // 30000-49999 test database, 50000-54999 E2E backend, 55000-59999 E2E web.
    expect(Number(defaultPostgresTestPort)).toBeGreaterThanOrEqual(30000)
    expect(port).toBeLessThan(30000)
  })

  test('is published to compose so the container follows this checkout', () => {
    expect(composeEnv().PRIVATE_STORAGE_S3_PORT).toBe(defaultPrivateStorageS3Port)
  })
})

describe('assertLocalPrivateStorageEndpoint', () => {
  test('accepts loopback endpoints', () => {
    for (const endpoint of ['http://127.0.0.1:24331', 'http://localhost:9000', 'http://[::1]:1']) {
      expect(assertLocalPrivateStorageEndpoint(endpoint)).toBe(endpoint)
    }
  })

  test('refuses anything that is not loopback, so this cannot touch a real bucket', () => {
    for (const endpoint of [
      'https://storage.yandexcloud.net',
      'https://nyc3.digitaloceanspaces.com',
      'http://10.0.0.5:9000',
      'not-a-url',
    ]) {
      expect(() => assertLocalPrivateStorageEndpoint(endpoint)).toThrow()
    }
  })
})

describe('localPrivateStorageEnv', () => {
  test('describes a complete, loopback, path-style S3 configuration', () => {
    const env = localPrivateStorageEnv('24331')

    expect(env).toEqual({
      PRIVATE_STORAGE_DRIVER: 's3',
      PRIVATE_STORAGE_REGION: 'us-east-1',
      PRIVATE_STORAGE_BUCKET: 'local-private-storage',
      PRIVATE_STORAGE_ENDPOINT: 'http://127.0.0.1:24331',
      PRIVATE_STORAGE_ACCESS_KEY_ID: 'local-private-storage-not-a-real-key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY:
        'local-private-storage-not-a-real-secret-do-not-use-in-production',
      PRIVATE_STORAGE_FORCE_PATH_STYLE: 'true',
    })
  })

  test('uses credentials that are obviously disposable and cannot collide with real ones', () => {
    const env = localPrivateStorageEnv('24331')

    expect(env.PRIVATE_STORAGE_ACCESS_KEY_ID).toContain('not-a-real')
    expect(env.PRIVATE_STORAGE_SECRET_ACCESS_KEY).toContain('do-not-use-in-production')
  })

  test('renders an env block that can be pasted into a shell', () => {
    const lines = envBlock().split('\n')

    expect(lines).toHaveLength(7)
    expect(lines.every((line) => /^PRIVATE_STORAGE_[A-Z_]+=\S/.test(line))).toBe(true)
    expect(envBlock()).toContain(`PRIVATE_STORAGE_ENDPOINT=${localPrivateStorageEndpoint()}`)
  })
})

describe('localPrivateStorageCorsRule', () => {
  test('allows the methods and headers a browser upload actually uses', () => {
    const rule = localPrivateStorageCorsRule(
      ['http://localhost:5173'],
      ['Content-Type', 'If-None-Match'],
      ['ETag'],
    )

    expect(rule.AllowedMethods).toEqual(expect.arrayContaining(['GET', 'PUT', 'HEAD']))
    expect(rule.AllowedHeaders).toContain('If-None-Match')
    expect(rule.ExposeHeaders).toContain('ETag')
    expect(rule.AllowedOrigins).toEqual(['http://localhost:5173'])
    // A presigned URL carries its own authority, so the bucket never needs to accept it.
    expect(rule.AllowedHeaders).not.toContain('Authorization')
  })
})

describe('docker compose storage service', () => {
  test('pins the image, keeps the port on loopback, and versions the volume', async () => {
    const compose = await readFile(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).toContain('image: chrislusf/seaweedfs:4.41')
    expect(compose).not.toContain('seaweedfs:latest')
    expect(compose).toContain('"127.0.0.1:${PRIVATE_STORAGE_S3_PORT:-24331}:8333"')
    expect(compose).toContain('seaweedfs_4_41_data:/data')
  })
})

describe('storage lifecycle scripts', () => {
  test('stop keeps the volume and never takes other services down', async () => {
    const script = await readFile(resolve(repositoryRoot, 'scripts/storage-local.mjs'), 'utf8')

    // `down` would remove the database containers too, and `down --volumes` would delete the
    // objects a developer just uploaded. Stopping one named service is the whole point.
    expect(script).not.toContain("'down'")
    expect(script).toContain("'stop', localPrivateStorageService")
  })

  test('no teardown takes the whole compose project down with its volumes', async () => {
    // `docker compose down -v` cannot be scoped to a service. Any runner that used it would
    // stop the local storage container and delete the volume holding a developer's uploads as
    // a side effect of running tests - which is precisely what this repository must not do.
    for (const path of [
      'webapp/e2e/global-teardown.ts',
      'backend/scripts/docker-smoke.mjs',
      'scripts/storage-local.mjs',
    ]) {
      const source = await readFile(resolve(repositoryRoot, path), 'utf8')
      // Matches `down` only where it would be passed as a docker argument, so the prose
      // explaining why it is avoided does not trip this.
      const codeWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

      expect(codeWithoutComments).not.toMatch(/['"]down['"]/)
    }
  })

  test('the storage volume name is stated identically wherever teardown must avoid it', async () => {
    const [compose, repoEnv, e2eEnv] = await Promise.all([
      readFile(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8'),
      readFile(resolve(repositoryRoot, 'scripts/repo-env.mjs'), 'utf8'),
      readFile(resolve(repositoryRoot, 'webapp/e2e/env.ts'), 'utf8'),
    ])

    expect(compose).toContain('postgres_18_test_data')
    expect(repoEnv).toContain("postgresTestDataVolume = 'postgres_18_test_data'")
    expect(e2eEnv).toContain("postgresTestDataVolume = 'postgres_18_test_data'")
  })

  test('every docker command is scoped to this repository’s compose project', async () => {
    const script = await readFile(resolve(repositoryRoot, 'scripts/storage-local.mjs'), 'utf8')
    const dockerCalls = [...script.matchAll(/run\('docker', \[([^\]]*)\]/g)].map(
      (match) => match[1],
    )

    expect(dockerCalls.length).toBeGreaterThan(0)
    expect(dockerCalls.every((call) => call.includes('...composeArgs'))).toBe(true)
    expect(script).toContain("['compose', '-p', composeProjectName]")
  })
})
