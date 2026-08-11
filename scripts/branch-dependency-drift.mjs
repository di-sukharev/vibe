import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { repositoryRoot } from './repo-env.mjs'

/**
 * Keeps `master` and `mobile` declaring the same versions, and keeps `node_modules` matching the
 * branch you are actually on.
 *
 * Both halves exist because of the same incident. A workspace-wide dependency sweep landed on
 * `mobile` alone and was never mirrored; every sync since runs master -> mobile, so the drift was
 * one-way and self-perpetuating. It went unnoticed for eight days because the evidence is
 * invisible: Prisma's generated client is git-ignored, so a version regression produces a
 * zero-line diff, and this repository deliberately has no hosted CI to catch it.
 *
 * The second half is subtler and cost a whole afternoon: switching branches without reinstalling
 * leaves the previous branch's `node_modules` in place, and every check then reports on
 * dependencies the branch does not declare. That produces confident green runs that mean nothing.
 */

/** Manifests both branches own. `mobile/package.json` is deliberately absent - it is mobile-only. */
export const sharedManifests = [
  'package.json',
  'backend/package.json',
  'webapp/package.json',
  'website/package.json',
  'packages/contracts/package.json',
]

/**
 * Where the branches are allowed to disagree, and why.
 *
 * Each entry needs a reason a reader can check. An exception without one is how a forgotten
 * downgrade starts looking like a deliberate constraint - which is exactly what these two looked
 * like before anyone traced them back to Expo.
 */
export const allowedDrift = [
  {
    manifest: 'website/package.json',
    packages: ['react', 'react-dom'],
    reason:
      'React Native 0.86 in the mobile workspace forces one React across the monorepo, so `mobile` holds an older exact version than `master` can use.',
  },
]

function isAllowed(manifest, name) {
  return allowedDrift.some((entry) => entry.manifest === manifest && entry.packages.includes(name))
}

const dependencySections = ['dependencies', 'devDependencies', 'overrides']

/**
 * Ranges declared for the same package on both branches must match.
 *
 * Only packages present in *both* manifests are compared: `mobile` adding a dependency `master`
 * has never heard of is the whole point of the branch, not drift.
 */
export function branchRangeDrift({ ours, theirs, ourBranch, theirBranch }) {
  const errors = []

  for (const manifest of sharedManifests) {
    const mine = ours[manifest]
    const other = theirs[manifest]
    if (!mine || !other) continue

    for (const section of dependencySections) {
      const a = mine[section] ?? {}
      const b = other[section] ?? {}

      for (const [name, range] of Object.entries(a)) {
        if (!(name in b) || b[name] === range || isAllowed(manifest, name)) continue

        errors.push(
          `${manifest} declares ${name} as ${range} on ${ourBranch} and ${b[name]} on ${theirBranch}. Align them, or add the package to allowedDrift in scripts/branch-dependency-drift.mjs with the reason.`,
        )
      }
    }
  }

  return errors
}

/**
 * Every directly declared dependency must be installed at the version this branch's lockfile
 * resolved. Anything else means `node_modules` belongs to another branch, and every check run
 * against it is answering a question nobody asked.
 */
export function installedVersionDrift({ manifests, resolved, installedVersion }) {
  const errors = []
  const seen = new Set()

  for (const manifest of Object.values(manifests)) {
    for (const section of ['dependencies', 'devDependencies']) {
      for (const name of Object.keys(manifest[section] ?? {})) {
        if (seen.has(name) || name.startsWith('workspace:')) continue
        seen.add(name)

        const expected = resolved[name]
        if (!expected) continue

        const actual = installedVersion(name)
        if (actual === undefined || actual === expected) continue

        errors.push(
          `${name} is installed at ${actual} but this branch's lockfile resolves ${expected}. Run \`bun install\` - node_modules is left over from another branch, and every check is reporting on the wrong dependencies.`,
        )
      }
    }
  }

  return errors
}

/** Resolved versions from a `bun.lock`, keyed by package name. */
export function resolvedVersions(lockContents) {
  const versions = {}

  for (const [, name, version] of lockContents.matchAll(
    /"((?:@[^"/]+\/)?[^"@/][^"]*)": \["\1@(\d[^"]*)"/g,
  )) {
    versions[name] = version
  }

  return versions
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    if (allowFailure) return null
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }

  return result.stdout
}

function parse(contents) {
  return contents === null ? null : JSON.parse(contents)
}

function readManifests(ref) {
  const manifests = {}
  for (const path of sharedManifests) {
    const contents = ref
      ? git(['show', `${ref}:${path}`], { allowFailure: true })
      : readFileSync(resolve(repositoryRoot, path), 'utf8')
    const parsed = parse(contents)
    if (parsed) manifests[path] = parsed
  }

  return manifests
}

function installedVersionFromDisk(name) {
  try {
    return JSON.parse(
      readFileSync(resolve(repositoryRoot, 'node_modules', name, 'package.json'), 'utf8'),
    ).version
  } catch {
    return undefined
  }
}

if (import.meta.main) {
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim()
  const ours = readManifests(null)
  const errors = []

  // The counterpart ref is absent in an installed project that kept only one line, and that is a
  // legitimate state - check what can be checked rather than failing on a branch nobody has.
  const counterpart = branch === 'mobile' ? 'origin/master' : 'origin/mobile'
  const counterpartExists = git(['rev-parse', '--verify', counterpart], { allowFailure: true })

  if (counterpartExists) {
    errors.push(
      ...branchRangeDrift({
        ours,
        theirs: readManifests(counterpart),
        ourBranch: branch || 'HEAD',
        theirBranch: counterpart,
      }),
    )
  } else {
    console.log(`No ${counterpart} in this checkout, so only the installed tree is checked.`)
  }

  errors.push(
    ...installedVersionDrift({
      manifests: ours,
      resolved: resolvedVersions(readFileSync(resolve(repositoryRoot, 'bun.lock'), 'utf8')),
      installedVersion: installedVersionFromDisk,
    }),
  )

  if (errors.length > 0) {
    console.error(`Dependency drift check failed:\n- ${errors.join('\n- ')}`)
    process.exit(1)
  }

  console.log('Dependency drift check passed.')
}
