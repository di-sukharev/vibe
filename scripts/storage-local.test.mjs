import { expect, test } from 'bun:test'

import { storageE2ePlaywrightArgs } from './storage-local.mjs'

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
