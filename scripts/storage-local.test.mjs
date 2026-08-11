import { describe, expect, test } from 'bun:test'

import {
  assertLocalPrivateStorageEndpoint,
} from './repo-env.mjs'

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
