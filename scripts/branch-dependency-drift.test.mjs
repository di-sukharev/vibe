import { expect, test } from 'bun:test'

import {
  allowedDrift,
  branchRangeDrift,
  installedVersionDrift,
  resolvedVersions,
  sharedManifests,
} from './branch-dependency-drift.mjs'

const ourBranch = 'master'
const theirBranch = 'origin/mobile'

function drift(ours, theirs) {
  return branchRangeDrift({ ours, theirs, ourBranch, theirBranch })
}

test('a package declared differently on the two branches is reported by name', () => {
  const errors = drift(
    { 'backend/package.json': { dependencies: { hono: '^4.12.31' } } },
    { 'backend/package.json': { dependencies: { hono: '^4.13.1' } } },
  )

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('hono')
  expect(errors[0]).toContain('^4.12.31')
  expect(errors[0]).toContain('^4.13.1')
})

test('a dependency only one branch has is not drift', () => {
  // `mobile` adding Expo, IAP and social auth packages is the entire point of the branch.
  const errors = drift(
    { 'backend/package.json': { dependencies: { hono: '^4.13.1' } } },
    { 'backend/package.json': { dependencies: { hono: '^4.13.1', 'google-auth-library': '^10.9.1' } } },
  )

  expect(errors).toEqual([])
})

test('overrides are compared too, because they decide versions for the whole tree', () => {
  // The @hono/node-server major lived here, not in any workspace's dependencies.
  const errors = drift(
    { 'package.json': { overrides: { '@hono/node-server': '^1.19.14' } } },
    { 'package.json': { overrides: { '@hono/node-server': '^2.0.12' } } },
  )

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('@hono/node-server')
})

test('a documented exception is allowed, and only in the manifest it was granted for', () => {
  const websiteReact = {
    'website/package.json': { dependencies: { react: '^19.2.7' } },
    'webapp/package.json': { dependencies: { react: '^19.2.8' } },
  }
  const theirs = {
    'website/package.json': { dependencies: { react: '19.2.3' } },
    'webapp/package.json': { dependencies: { react: '19.2.3' } },
  }

  const errors = drift(websiteReact, theirs)

  // website is on the exception list; webapp is not, so the same package still fails there.
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('webapp/package.json')
})

test('every exception carries a reason someone can check', () => {
  // An exception without one is indistinguishable from a forgotten downgrade - which is what
  // these looked like until they were traced back to React Native.
  for (const entry of allowedDrift) {
    expect(sharedManifests).toContain(entry.manifest)
    expect(entry.packages.length).toBeGreaterThan(0)
    expect(entry.reason.length).toBeGreaterThan(30)
  }
})

test('mobile-only manifests are outside the comparison', () => {
  // `mobile/package.json` has no counterpart on master, so comparing it would report the whole
  // Expo tree as drift.
  expect(sharedManifests).not.toContain('mobile/package.json')
})

test('resolvedVersions reads the lockfile the way bun writes it', () => {
  const lock = `{
  "lockfileVersion": 1,
  "packages": {
    "hono": ["hono@4.13.1", "", {}, "sha512-abc=="],
    "@prisma/client": ["@prisma/client@7.9.0", "", { "dependencies": {} }, "sha512-def=="],
    "@aws-sdk/core/@smithy/core": ["@smithy/core@3.29.5", "", {}, "sha512-ghi=="],
  }
}`

  const versions = resolvedVersions(lock)

  expect(versions.hono).toBe('4.13.1')
  expect(versions['@prisma/client']).toBe('7.9.0')
  // A nested entry is keyed by its path, so it must not overwrite the hoisted package's version.
  expect(versions['@smithy/core']).toBeUndefined()
})

test('an installed version that disagrees with the lockfile names the fix', () => {
  // The false-green that started this: node_modules left over from the other branch, and every
  // check happily reporting on dependencies this branch does not declare.
  const errors = installedVersionDrift({
    manifests: { 'backend/package.json': { dependencies: { '@prisma/client': '7.9.0' } } },
    resolved: { '@prisma/client': '7.9.0' },
    installedVersion: () => '7.9.1',
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('@prisma/client')
  expect(errors[0]).toContain('bun install')
})

test('a dependency that is not installed at all is left to the package manager', () => {
  // An optional or platform-specific package legitimately may not be on disk; that is `bun
  // install`'s business, not this check's.
  const errors = installedVersionDrift({
    manifests: { 'backend/package.json': { dependencies: { fsevents: '^2.3.3' } } },
    resolved: { fsevents: '2.3.3' },
    installedVersion: () => undefined,
  })

  expect(errors).toEqual([])
})

test('a matching install reports nothing', () => {
  const errors = installedVersionDrift({
    manifests: { 'backend/package.json': { dependencies: { hono: '^4.13.1' } } },
    resolved: { hono: '4.13.1' },
    installedVersion: () => '4.13.1',
  })

  expect(errors).toEqual([])
})
