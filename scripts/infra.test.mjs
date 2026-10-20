import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { discardDisposableSecrets, writeDisposableRootInputs } from './infra.mjs'

describe('managed root inputs', () => {
  test('cross-state secrets leave the working tree when the command ends', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'infra-managed-root-'))
    const foundationPath = resolve(root, 'foundation.auto.tfvars.json')
    const releasePath = resolve(root, 'release.auto.tfvars.json')

    try {
      writeDisposableRootInputs(
        root,
        { jwt_secret: 'test-jwt-secret-value', media_secret_access_key: 'test-media-key' },
        { runtime_image_digest: 'sha256:0000' },
      )

      expect(readFileSync(foundationPath, 'utf8')).toContain('test-jwt-secret-value')
      expect(readFileSync(releasePath, 'utf8')).toContain('sha256:0000')

      discardDisposableSecrets()

      expect(existsSync(foundationPath)).toBe(false)
      expect(existsSync(releasePath)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('discarding twice is safe and forgets what it already removed', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'infra-managed-root-'))

    try {
      writeDisposableRootInputs(root, { jwt_secret: 'test-jwt-secret-value' }, {})
      discardDisposableSecrets()
      writeFileSync(resolve(root, 'foundation.auto.tfvars.json'), 'written by an operator')

      discardDisposableSecrets()

      expect(readFileSync(resolve(root, 'foundation.auto.tfvars.json'), 'utf8')).toBe(
        'written by an operator',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
