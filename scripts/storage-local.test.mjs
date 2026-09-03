import { afterEach, expect, test } from 'bun:test'

import {
  defaultPrivateStorageS3Port,
  localPrivateStorageAccessKeyId,
  localPrivateStorageBucket,
  localPrivateStorageEndpoint,
  localPrivateStorageSecretAccessKey,
} from './repo-env.mjs'
import { corsOrigins, envBlock, storageE2ePlaywrightArgs } from './storage-local.mjs'

test('local S3 browser validation keeps the avatar scope while forwarding options', () => {
  expect(storageE2ePlaywrightArgs([])).toEqual(['e2e/specs/avatar.spec.ts'])
  expect(storageE2ePlaywrightArgs(['--', '--list', '-g', 'uploads an avatar'])).toEqual([
    'e2e/specs/avatar.spec.ts',
    '--list',
    '-g',
    'uploads an avatar',
  ])
  expect(() => storageE2ePlaywrightArgs(['auth.spec.ts'])).toThrow(
    'keeps its file scope on avatar.spec.ts',
  )
})

const originalCorsOrigins = process.env.CORS_ORIGINS

afterEach(() => {
  if (originalCorsOrigins === undefined) {
    delete process.env.CORS_ORIGINS
  } else {
    process.env.CORS_ORIGINS = originalCorsOrigins
  }
})

test('corsOrigins returns the configured allowlist, trimmed and split on commas', () => {
  process.env.CORS_ORIGINS = 'https://example.com, https://admin.example.com'
  expect(corsOrigins()).toEqual(['https://example.com', 'https://admin.example.com'])
})

test('corsOrigins falls back to a wildcard when nothing is configured', () => {
  delete process.env.CORS_ORIGINS
  expect(corsOrigins()).toEqual(['*'])

  process.env.CORS_ORIGINS = ''
  expect(corsOrigins()).toEqual(['*'])
})

test('corsOrigins forces the wildcard for anyOrigin regardless of CORS_ORIGINS', () => {
  process.env.CORS_ORIGINS = 'https://example.com'
  expect(corsOrigins({ anyOrigin: true })).toEqual(['*'])
})

test('envBlock renders every PRIVATE_STORAGE_* line as NAME=value, in a fixed order', () => {
  expect(envBlock().split('\n')).toEqual([
    'PRIVATE_STORAGE_DRIVER=s3',
    'PRIVATE_STORAGE_REGION=us-east-1',
    `PRIVATE_STORAGE_BUCKET=${localPrivateStorageBucket}`,
    `PRIVATE_STORAGE_ENDPOINT=${localPrivateStorageEndpoint(defaultPrivateStorageS3Port)}`,
    `PRIVATE_STORAGE_ACCESS_KEY_ID=${localPrivateStorageAccessKeyId}`,
    `PRIVATE_STORAGE_SECRET_ACCESS_KEY=${localPrivateStorageSecretAccessKey}`,
    'PRIVATE_STORAGE_FORCE_PATH_STYLE=true',
  ])
})
