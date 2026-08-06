import { expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  billingManualSteps,
  billingMigrationDirectories,
  billingOwnedPaths,
  billingSeamFiles,
  removeBilling,
  stripCapabilitySeams,
} from './remove-billing.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function exists(target) {
  try {
    await access(path.isAbsolute(target) ? target : path.join(repositoryRoot, target))
    return true
  } catch {
    return false
  }
}

test('every path the removal script targets still exists', async () => {
  const missing = []

  for (const target of [...billingOwnedPaths, ...billingMigrationDirectories, ...billingSeamFiles]) {
    if (!(await exists(target))) missing.push(target)
  }

  expect(missing).toEqual([])
})

test('every seam file actually carries billing markers', async () => {
  const withoutMarkers = []

  for (const seamFile of billingSeamFiles) {
    const source = await Bun.file(path.join(repositoryRoot, seamFile)).text()
    if (!source.includes('capability:billing:start')) withoutMarkers.push(seamFile)
  }

  expect(withoutMarkers).toEqual([])
})

test('every file wired to store credentials is covered by the manifest', async () => {
  // The manifest is only useful if it is complete: a file that reads store env but is neither
  // owned, marked, nor named in a manual step is exactly what leaves a red typecheck behind.
  const marker = /IAP_BODY_LIMIT_BYTES|IAP_RATE_LIMIT_|APPLE_IAP_|GOOGLE_PLAY_/
  const manualStepText = billingManualSteps.join('\n')
  const uncovered = []

  for await (const file of walkSources(repositoryRoot)) {
    const relativePath = path.relative(repositoryRoot, file)
    if (relativePath.startsWith('scripts/remove-billing')) continue

    const source = await readFile(file, 'utf8')
    if (!marker.test(source)) continue

    const owned = billingOwnedPaths.some((target) => relativePath.startsWith(target))
    const seamed = billingSeamFiles.includes(relativePath) && source.includes('capability:billing')
    const documented = manualStepText.includes(relativePath)
    if (!owned && !seamed && !documented) uncovered.push(relativePath)
  }

  expect(uncovered).toEqual([])
})

async function* walkSources(directory) {
  const ignored = new Set(['.git', 'node_modules', 'generated', 'dist', '.expo', '.scratch'])

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* walkSources(entryPath)
      continue
    }
    if (/\.(?:[cm]?[jt]sx?|prisma)$/.test(entry.name)) yield entryPath
  }
}

test('stripping seams removes marked regions and keeps the rest', () => {
  const source = [
    'keep one',
    '// capability:billing:start',
    'drop this',
    '// capability:billing:end',
    'keep two',
  ].join('\n')

  expect(stripCapabilitySeams(source)).toBe('keep one\nkeep two')
})

test('stripping is scoped to the named capability', () => {
  const source = [
    '// capability:notifications:start',
    'keep push wiring',
    '// capability:notifications:end',
    '// capability:billing:start',
    'drop billing wiring',
    '// capability:billing:end',
  ].join('\n')

  expect(stripCapabilitySeams(source, 'billing')).toBe(
    '// capability:notifications:start\nkeep push wiring\n// capability:notifications:end',
  )
})

test('unbalanced markers fail loudly instead of silently deleting the rest of a file', () => {
  const source = ['before', '// capability:billing:start', 'after'].join('\n')

  expect(() => stripCapabilitySeams(source)).toThrow('Unbalanced billing capability markers')
})

test('the manual step list names the wiring the script cannot delete mechanically', () => {
  // These are the places a marked region cannot express: an element wrapper, a task map entry,
  // env validation, and generator coverage. If one is automated later, drop it from the list.
  const steps = billingManualSteps.join('\n')

  expect(steps).toContain('AppProviders.tsx')
  expect(steps).toContain('profile.tsx')
  expect(steps).toContain('cron.ts')
  expect(steps).toContain('env.ts')
  expect(steps).toContain('CHECKLIST.md')
})

async function buildFixture({ breakMarkers = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'remove-billing-'))

  for (const ownedPath of billingOwnedPaths) {
    await mkdir(path.join(root, path.dirname(ownedPath)), { recursive: true })
    await writeFile(path.join(root, ownedPath), 'billing artifact\n')
  }
  for (const migration of billingMigrationDirectories) {
    await mkdir(path.join(root, migration), { recursive: true })
    await writeFile(path.join(root, migration, 'migration.sql'), 'select 1;\n')
  }
  for (const [index, seamFile] of billingSeamFiles.entries()) {
    await mkdir(path.join(root, path.dirname(seamFile)), { recursive: true })
    const end =
      breakMarkers && index === billingSeamFiles.length - 1 ? '' : '// capability:billing:end\n'
    await writeFile(
      path.join(root, seamFile),
      `keep me\n// capability:billing:start\ndrop me\n${end}`,
    )
  }

  return root
}

test('running the removal against a fixture deletes owned paths and strips seams', async () => {
  const root = await buildFixture()

  try {
    await removeBilling({ root, log: () => undefined })

    for (const ownedPath of [...billingOwnedPaths, ...billingMigrationDirectories]) {
      expect(await exists(path.join(root, ownedPath))).toBe(false)
    }
    for (const seamFile of billingSeamFiles) {
      expect(await readFile(path.join(root, seamFile), 'utf8')).toBe('keep me\n')
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('--keep-migrations leaves the billing migrations in place', async () => {
  const root = await buildFixture()

  try {
    await removeBilling({ keepMigrations: true, root, log: () => undefined })

    for (const migration of billingMigrationDirectories) {
      expect(await exists(path.join(root, migration))).toBe(true)
    }
    expect(await exists(path.join(root, billingOwnedPaths[0]))).toBe(false)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('a broken marker aborts before anything is deleted', async () => {
  const root = await buildFixture({ breakMarkers: true })

  try {
    await expect(removeBilling({ root, log: () => undefined })).rejects.toThrow(
      'Unbalanced billing capability markers',
    )

    // Nothing may be gone: a half-removed capability is worse than a failed run.
    for (const ownedPath of [...billingOwnedPaths, ...billingMigrationDirectories]) {
      expect(await exists(path.join(root, ownedPath))).toBe(true)
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
