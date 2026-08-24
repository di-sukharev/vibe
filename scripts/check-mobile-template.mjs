import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateCapabilityContract } from './template-check.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * The release gate for the `mobile` line: it is publishable only when it is `master` plus the app.
 *
 * Git state defines the branch relationship. The command ladder below separately proves the
 * repository invariants and runnable local surfaces without matching prose or translations.
 */
function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
}

function mobileReleaseErrors({ branch, status, head, originMobile, masterIsAncestor, requirePublished }) {
  const errors = []

  if (branch !== 'mobile') errors.push('current branch must be mobile')
  if (status !== '') errors.push('worktree and index must be clean')
  if (!masterIsAncestor) errors.push('origin/master must be an ancestor of mobile HEAD')
  if (requirePublished && head !== originMobile) {
    errors.push('HEAD must equal the published origin/mobile ref')
  }

  return errors
}

const mobileCapabilityContract = {
  'Payments / subscriptions': 'available',
  'Push notifications': 'available',
  'Social sign-in (Apple / Google)': 'available',
}

export function validateMobileCapabilityContract(source) {
  return validateCapabilityContract(source, mobileCapabilityContract, {
    exclusiveState: 'available',
  })
}

const mobileValidationCommands = [
  ['run', 'check'],
  ['run', '--cwd', 'mobile', 'e2e:maestro:audit'],
]

export function runMobileValidation(execute = execFileSync) {
  for (const args of mobileValidationCommands) {
    execute('bun', args, { cwd: repositoryRoot, stdio: 'inherit' })
  }
}

if (import.meta.main) {
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', 'origin/master', 'HEAD'], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  })
  if (ancestor.error) throw ancestor.error

  const errors = [
    ...mobileReleaseErrors({
      branch: git(['branch', '--show-current']),
      status: git(['status', '--porcelain=v1']),
      head: git(['rev-parse', 'HEAD']),
      originMobile: git(['rev-parse', 'origin/mobile']),
      masterIsAncestor: ancestor.status === 0,
      requirePublished: process.argv.includes('--published'),
    }),
    ...validateMobileCapabilityContract(
      readFileSync(resolve(repositoryRoot, 'CHECKLIST.md'), 'utf8'),
    ),
  ]

  if (errors.length > 0) {
    console.error(`Mobile template check failed:\n- ${errors.join('\n- ')}`)
    process.exit(1)
  }

  runMobileValidation()
  console.log('Mobile template check passed.')
}
